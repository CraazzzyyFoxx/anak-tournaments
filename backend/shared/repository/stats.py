"""Native stats writes. Repositories flush; services own revisions, evidence scopes and commit boundaries."""

from __future__ import annotations

import math
from collections.abc import Awaitable, Callable, Mapping, Sequence
from datetime import datetime, timedelta
from typing import Literal

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from shared import models
from shared.core.errors import BaseAPIException
from shared.disciplines import DisciplineSpec

__all__ = (
    "StatDefRepository",
    "EventTypeRepository",
    "StatsMatchRepository",
    "IngestJobRepository",
    "stalled_conditions",
)

#: Source kinds of the admin/Discord/bot raw-log channels. They share one decoder, so identical bytes through any of
#: them are the same job; a canonical document's ``source.kind`` is provenance and never joins this set.
UPLOAD_SOURCE_KINDS = frozenset({"upload", "discord", "manual"})


async def _project_vocabulary(session: AsyncSession, spec: DisciplineSpec, *, kind: str) -> None:
    # Runtime import avoids repository -> audit service -> repository initialization cycles.
    from shared.services.stats_evidence import capture_stats_evidence, stage_stats_evidence

    table = models.StatDef.__table__ if kind == "stat" else models.EventType.__table__
    declarations = spec.stat_defs if kind == "stat" else spec.event_types
    declared = {}
    for order, definition in enumerate(declarations):
        if not definition.code or len(definition.code) > 64 or definition.code in declared:
            raise ValueError("vocabulary codes must be nonempty, unique and fit 64 characters")
        if not definition.name or len(definition.name) > 128:
            raise ValueError("vocabulary names must fit 128 characters")
        values = {"name": definition.name, "active": True}
        if kind == "stat":
            if definition.value_format not in {"integer", "decimal", "percent", "duration"}:
                raise ValueError("unknown stat value format")
            if definition.aggregation not in {"sum", "max", "min", "avg", "last"}:
                raise ValueError("unknown stat aggregation")
            if definition.group is not None and len(definition.group) > 32:
                raise ValueError("stat group must fit 32 characters")
            values.update(
                value_format=definition.value_format,
                aggregation=definition.aggregation,
                stat_group=definition.group,
                sort_order=order,
            )
        declared[definition.code] = values

    await session.execute(
        sa.text("SELECT pg_advisory_xact_lock(hashtext(:key))"), {"key": f"stats:vocabulary:{spec.code}"}
    )
    existing = {
        row["code"]: row
        for row in (await session.execute(sa.select(table).where(table.c.discipline == spec.code))).mappings()
    }
    changes = [
        (code, values)
        for code, values in declared.items()
        if code not in existing or any(existing[code][key] != value for key, value in values.items())
    ]
    changes.extend(
        (code, {"active": False}) for code, row in existing.items() if code not in declared and row["active"]
    )
    for offset in range(0, len(changes), 100):
        batch = changes[offset : offset + 100]
        scopes = [("vocabulary", (spec.code, kind, code), "definition") for code, _ in batch]
        before = await capture_stats_evidence(session, scopes=scopes)
        for code, values in batch:
            if code in existing:
                await session.execute(sa.update(table).where(table.c.id == existing[code]["id"]).values(**values))
            else:
                # Existing rows NEVER reach nextval: ON CONFLICT would consume a SMALLINT identity on each startup.
                await session.execute(sa.insert(table).values(discipline=spec.code, code=code, **values))
        await session.flush()
        after = await capture_stats_evidence(session, scopes=scopes)
        await stage_stats_evidence(
            session,
            operation="stats.vocabulary_project",
            before=before,
            after=after,
            workspace_id=None,
            entity_type="stats_vocabulary",
            entity_id=None,
        )


class StatDefRepository:
    async def project_module(self, session: AsyncSession, spec: DisciplineSpec) -> None:
        await _project_vocabulary(session, spec, kind="stat")

    async def ids(self, session: AsyncSession, *, discipline: str) -> dict[str, int]:
        table = models.StatDef.__table__
        return dict(
            (await session.execute(sa.select(table.c.code, table.c.id).where(table.c.discipline == discipline))).all()
        )


class EventTypeRepository:
    async def project_module(self, session: AsyncSession, spec: DisciplineSpec) -> None:
        await _project_vocabulary(session, spec, kind="event")

    async def ids(self, session: AsyncSession, *, discipline: str) -> dict[str, int]:
        table = models.EventType.__table__
        return dict(
            (await session.execute(sa.select(table.c.code, table.c.id).where(table.c.discipline == discipline))).all()
        )


def _rows(model: type, rows: Sequence[dict], match_id: int) -> list[dict]:
    """Normalize optional Core columns once; executemany must not silently drop a later row's extra keys."""
    table = model.__table__
    columns = {column.name for column in table.columns} - ({"id"} if model is models.StatsEvent else set())
    defaults = {
        column.name: column.default.arg
        for column in table.columns
        if column.default is not None and column.default.is_scalar
    }
    defaults.update({column.name: None for column in table.columns if column.nullable})
    if model is models.StatsSegment:
        defaults["attrs"] = {}
    integer_columns = [
        column.name for column in table.columns if column.name in columns and isinstance(column.type, sa.Integer)
    ]
    result = []
    for row in rows:
        if row.get("match_id") != match_id or row.keys() - columns:
            raise ValueError(f"{table.name}: foreign match or unknown native columns")
        normalized = defaults | row
        if columns - normalized.keys():
            raise ValueError(f"{table.name}: missing required columns")
        if any(
            normalized[column.name] is None
            for column in table.columns
            if column.name in columns and not column.nullable
        ):
            raise ValueError(f"{table.name}: null required column")
        if any(
            normalized[name] is not None
            and (type(normalized[name]) is not int or (name.endswith("_id") and normalized[name] <= 0))
            for name in integer_columns
        ):
            raise ValueError(f"{table.name}: identities and positions must be integers")
        result.append(normalized)
    return result


async def _bulk_insert(session: AsyncSession, model: type, rows: Sequence[dict]) -> None:
    # Core keeps explicit NULL keys. Bound parameters stay below asyncpg's 32767 ceiling, also with wide events.
    size = max(1, 30_000 // len(model.__table__.columns))
    for offset in range(0, len(rows), size):
        await session.execute(sa.insert(model.__table__), rows[offset : offset + size])


def _integer(value, *, minimum: int = 1, maximum: int | None = None) -> bool:
    return type(value) is int and value >= minimum and (maximum is None or value <= maximum)


def _finite(value) -> bool:
    if not isinstance(value, (int, float)) or isinstance(value, bool):
        return False
    try:
        return math.isfinite(value)
    except OverflowError:
        return False


async def _validate_match(session: AsyncSession, match: models.StatsMatch) -> None:
    """Check persisted direct ownership and any proven game binding without flushing untrusted changes."""
    m, game, encounter = models.StatsMatch.__table__, models.EncounterGame.__table__, models.Encounter.__table__
    row = (
        (
            await session.execute(
                sa.select(
                    m.c.workspace_id,
                    m.c.discipline,
                    m.c.encounter_id,
                    m.c.source_map_index,
                    m.c.encounter_game_id,
                    m.c.map_entity_id,
                    m.c.mode_entity_id,
                    game.c.map_id,
                    game.c.mode_id,
                    game.c.encounter_id.label("game_encounter_id"),
                    encounter.c.workspace_id.label("owner_workspace"),
                    encounter.c.discipline.label("owner_discipline"),
                )
                .join(encounter, encounter.c.id == m.c.encounter_id)
                .outerjoin(game, game.c.id == m.c.encounter_game_id)
                .where(m.c.id == match.id)
                .with_for_update(of=m)
            )
        )
        .mappings()
        .one_or_none()
    )
    if row is None or any(
        row[key] != getattr(match, key)
        for key in (
            "workspace_id",
            "discipline",
            "encounter_id",
            "encounter_game_id",
            "map_entity_id",
            "mode_entity_id",
            "source_map_index",
        )
    ):
        raise ValueError("match header must agree with its persisted owner")
    if (
        match.workspace_id != row["owner_workspace"]
        or match.discipline != row["owner_discipline"]
        or match.map_kind != "map"
    ):
        raise ValueError("match workspace and discipline must agree with its encounter")
    # A game without a map yet (filled when the result applies) admits the observation's; modes differ only when both
    # are known.
    if match.encounter_game_id is not None and (
        row["game_encounter_id"] != match.encounter_id
        or row["map_id"] not in (None, match.map_entity_id)
        or (None not in (row["mode_id"], match.mode_entity_id) and row["mode_id"] != match.mode_entity_id)
    ):
        raise ValueError("match encounter, map and mode must agree with its game")
    entity = models.CatalogEntity.__table__
    if not await session.scalar(
        sa.select(entity.c.id).where(
            entity.c.id == match.map_entity_id, entity.c.kind == "map", entity.c.discipline == match.discipline
        )
    ):
        raise ValueError("match map belongs to another discipline or catalog kind")
    if match.ingest_job_id is not None:
        job = models.IngestJob.__table__
        if not await session.scalar(
            sa.select(job.c.id).where(
                job.c.id == match.ingest_job_id,
                job.c.workspace_id == match.workspace_id,
                job.c.discipline == match.discipline,
            )
        ):
            raise ValueError("ingest job belongs to another owner")


async def _validate_ids(session: AsyncSession, table: sa.Table, ids: set[int], *conditions) -> None:
    if not ids:
        return
    if any(not _integer(value) for value in ids):
        raise ValueError(f"invalid {table.name} identity")
    found = set((await session.execute(sa.select(table.c.id).where(table.c.id.in_(ids), *conditions))).scalars())
    if found != ids:
        raise ValueError(f"unknown, inactive or foreign {table.name} identity")


async def _validate_teams_players(
    session: AsyncSession, match: models.StatsMatch, teams: Sequence[dict], players: Sequence[dict]
) -> tuple[set[int], dict[int, int]]:
    team_ids = set()
    for position, team in enumerate(teams, 1):
        tid = team["encounter_team_id"]
        if (
            not _integer(tid)
            or tid in team_ids
            or team["encounter_id"] != match.encounter_id
            or not _integer(team["source_position"])
            or team["source_position"] != position
        ):
            raise ValueError("match teams must follow their positive one-based input array order")
        team_ids.add(tid)
    game_team, encounter_team = models.EncounterGameTeam.__table__, models.EncounterTeam.__table__
    valid = set(
        (
            await session.execute(
                sa.select(game_team.c.encounter_team_id)
                .join(encounter_team, encounter_team.c.id == game_team.c.encounter_team_id)
                .where(
                    game_team.c.game_id == match.encounter_game_id,
                    game_team.c.encounter_id == match.encounter_id,
                    encounter_team.c.encounter_id == match.encounter_id,
                )
            )
        ).scalars()
    )
    if not team_ids or not team_ids <= valid:
        raise ValueError("match teams must participate in its encounter and game")
    member_teams = {}
    for player in players:
        member = player["workspace_member_id"]
        if not _integer(member) or member in member_teams or player["encounter_team_id"] not in team_ids:
            raise ValueError("match players must be unique and belong to an observed team")
        if (
            not isinstance(player["handle_snapshot"], str)
            or not player["handle_snapshot"].strip()
            or len(player["handle_snapshot"]) > 255
        ):
            raise ValueError("match player requires a usable handle snapshot")
        member_teams[member] = player["encounter_team_id"]
    member = models.WorkspaceMember.__table__
    await _validate_ids(session, member, set(member_teams), member.c.workspace_id == match.workspace_id)
    roles = {player["observed_role_id"] for player in players if player["observed_role_id"] is not None}
    role, dim = models.CatalogRole.__table__, models.RoleDimension.__table__
    dimensions = sa.select(dim.c.id).where(dim.c.discipline == match.discipline, dim.c.active.is_(True))
    await _validate_ids(
        session,
        role,
        roles,
        role.c.dimension_id.in_(dimensions),
        role.c.active.is_(True),
        sa.or_(role.c.workspace_id.is_(None), role.c.workspace_id == match.workspace_id),
    )
    return team_ids, member_teams


def _validate_segments(segments: Sequence[dict]) -> set[int]:
    numbers = set()
    for segment in segments:
        number = segment["segment"]
        if not _integer(number, maximum=32767) or number in numbers:
            raise ValueError("segments must be unique positive SMALLINTs; zero has no segment row")
        if not isinstance(segment["kind"], str) or not segment["kind"] or len(segment["kind"]) > 16:
            raise ValueError("segment kind must fit 16 characters")
        if not isinstance(segment["attrs"], dict):
            raise ValueError("segment attrs must be an object")
        numbers.add(number)
    return numbers


def _validate_segment(row: dict, segments: set[int]) -> None:
    number = row["segment"]
    if not _integer(number, minimum=0, maximum=32767) or (number and number not in segments):
        raise ValueError("observation segment must be zero or a declared segment")


async def _validate_facts(
    session: AsyncSession,
    match: models.StatsMatch,
    rows: Sequence[dict],
    teams: set[int],
    players: Mapping[int, int],
    segments: set[int],
) -> None:
    keys = set()
    for row in rows:
        _validate_segment(row, segments)
        team, member = row["encounter_team_id"], row["workspace_member_id"]
        if team not in teams or (member is not None and players.get(member) != team):
            raise ValueError("fact team must agree with its match player")
        if row["entity_kind"] != "character" or not _finite(row["value"]):
            raise ValueError("fact requires character kind and a finite value")
        key = tuple(
            row[column] for column in ("segment", "encounter_team_id", "workspace_member_id", "entity_id", "stat_id")
        )
        if key in keys:
            raise ValueError("duplicate null-equal fact key")
        keys.add(key)
    stat = models.StatDef.__table__
    await _validate_ids(
        session, stat, {row["stat_id"] for row in rows}, stat.c.discipline == match.discipline, stat.c.active.is_(True)
    )
    entity = models.CatalogEntity.__table__
    await _validate_ids(
        session,
        entity,
        {row["entity_id"] for row in rows if row["entity_id"] is not None},
        entity.c.discipline == match.discipline,
        entity.c.kind == "character",
    )


async def _validate_events(
    session: AsyncSession,
    match: models.StatsMatch,
    rows: Sequence[dict],
    teams: set[int],
    players: Mapping[int, int],
    segments: set[int],
) -> None:
    entities = set()
    for row in rows:
        _validate_segment(row, segments)
        if row["entity_kind"] != "character" or not _finite(row["t"]):
            raise ValueError("event requires character kind and a finite time")
        for prefix in ("actor", "target"):
            member, team = row[f"{prefix}_member_id"], row[f"{prefix}_team_id"]
            if (team is not None and team not in teams) or (
                member is not None and (team is None or players.get(member) != team)
            ):
                raise ValueError("event team must agree with its match player")
        entities.update(row[column] for column in ("entity_id", "related_entity_id") if row[column] is not None)
    event_type = models.EventType.__table__
    await _validate_ids(
        session,
        event_type,
        {row["type_id"] for row in rows},
        event_type.c.discipline == match.discipline,
        event_type.c.active.is_(True),
    )
    entity = models.CatalogEntity.__table__
    await _validate_ids(
        session, entity, entities, entity.c.discipline == match.discipline, entity.c.kind == "character"
    )


async def _fact_context(session: AsyncSession, match_id: int) -> tuple[set[int], dict[int, int], set[int]]:
    team, player, segment = (
        models.StatsMatchTeam.__table__,
        models.StatsMatchPlayer.__table__,
        models.StatsSegment.__table__,
    )
    teams = set(
        (await session.execute(sa.select(team.c.encounter_team_id).where(team.c.match_id == match_id))).scalars()
    )
    players = dict(
        (
            await session.execute(
                sa.select(player.c.workspace_member_id, player.c.encounter_team_id).where(player.c.match_id == match_id)
            )
        ).all()
    )
    segments = set(
        (await session.execute(sa.select(segment.c.segment).where(segment.c.match_id == match_id))).scalars()
    )
    return teams, players, segments


class StatsMatchRepository:
    async def get(self, session: AsyncSession, match_id: int) -> models.StatsMatch | None:
        return await session.get(models.StatsMatch, match_id)

    async def get_encounter_id(self, session: AsyncSession, match_id: int) -> int | None:
        return await session.scalar(sa.select(models.StatsMatch.encounter_id).where(models.StatsMatch.id == match_id))

    async def get_for_game(
        self,
        session: AsyncSession,
        *,
        encounter_game_id: int,
        workspace_id: int,
        discipline: str,
        for_update: bool = False,
    ) -> models.StatsMatch | None:
        match, game, encounter = models.StatsMatch, models.EncounterGame, models.Encounter
        query = (
            sa.select(match)
            .join(
                game,
                sa.and_(game.id == match.encounter_game_id, game.encounter_id == match.encounter_id),
            )
            .join(encounter, encounter.id == match.encounter_id)
            .where(
                match.encounter_game_id == encounter_game_id,
                match.workspace_id == workspace_id,
                match.discipline == discipline,
                encounter.workspace_id == workspace_id,
                encounter.discipline == discipline,
                sa.or_(game.map_id.is_(None), game.map_id == match.map_entity_id),
            )
        )
        if for_update:
            # The locked row is re-read, never an instance loaded before another transaction committed a revision.
            query = query.with_for_update(of=match).execution_options(populate_existing=True)
        return (await session.scalars(query)).one_or_none()

    async def add(self, session: AsyncSession, match: models.StatsMatch) -> models.StatsMatch:
        """Stage a new observation header; the caller flushes it inside its own transaction."""
        session.add(match)
        return match

    async def replace_observations(
        self,
        session: AsyncSession,
        *,
        match: models.StatsMatch,
        teams: Sequence[dict],
        players: Sequence[dict],
        segments: Sequence[dict],
        facts: Sequence[dict],
        events: Sequence[dict],
    ) -> None:
        """Validate the complete replacement before the first DELETE. Caller owns revision/evidence/commit."""
        if match.encounter_game_id is None:
            raise ValueError("new observations require a proven encounter game")
        teams = _rows(models.StatsMatchTeam, teams, match.id)
        players = _rows(models.StatsMatchPlayer, players, match.id)
        segments = _rows(models.StatsSegment, segments, match.id)
        facts = _rows(models.StatsFact, facts, match.id)
        events = _rows(models.StatsEvent, events, match.id)
        with session.no_autoflush:
            await _validate_match(session, match)
            team_ids, member_teams = await _validate_teams_players(session, match, teams, players)
            segment_ids = _validate_segments(segments)
            await _validate_facts(session, match, facts, team_ids, member_teams, segment_ids)
            await _validate_events(session, match, events, team_ids, member_teams, segment_ids)
        for model in (
            models.StatsEvent,
            models.StatsFact,
            models.StatsSegment,
            models.StatsMatchPlayer,
            models.StatsMatchTeam,
        ):
            table = model.__table__
            await session.execute(sa.delete(table).where(table.c.match_id == match.id))
        for model, rows in (
            (models.StatsMatchTeam, teams),
            (models.StatsMatchPlayer, players),
            (models.StatsSegment, segments),
            (models.StatsFact, facts),
            (models.StatsEvent, events),
        ):
            await _bulk_insert(session, model, rows)
        await session.flush()

    async def _match(self, session: AsyncSession, match_id: int, discipline: str) -> models.StatsMatch:
        match = (
            await session.scalars(
                sa.select(models.StatsMatch)
                .where(models.StatsMatch.id == match_id, models.StatsMatch.discipline == discipline)
                .with_for_update()
            )
        ).one_or_none()
        if match is None:
            raise ValueError("unknown match in discipline")
        await _validate_match(session, match)
        return match

    async def replace_fact_codes(
        self, session: AsyncSession, *, match_id: int, discipline: str, stat_codes: Sequence[str], rows: Sequence[dict]
    ) -> None:
        rows = _rows(models.StatsFact, rows, match_id)
        with session.no_autoflush:
            match = await self._match(session, match_id, discipline)
            stat = models.StatDef.__table__
            ids = dict(
                (
                    await session.execute(
                        sa.select(stat.c.code, stat.c.id).where(
                            stat.c.discipline == discipline, stat.c.code.in_(stat_codes), stat.c.active.is_(True)
                        )
                    )
                ).all()
            )
            if set(ids) != set(stat_codes) or any(row["stat_id"] not in ids.values() for row in rows):
                raise ValueError("fact replacement must use only the named active stat codes")
            if any(row["entity_id"] is not None for row in rows):
                raise ValueError("fact replacement accepts only non-character observations")
            await _validate_facts(session, match, rows, *(await _fact_context(session, match_id)))
        table = models.StatsFact.__table__
        await session.execute(
            sa.delete(table).where(
                table.c.match_id == match_id,
                table.c.stat_id.in_(ids.values()),
                table.c.entity_id.is_(None),
            )
        )
        await _bulk_insert(session, models.StatsFact, rows)
        await session.flush()

    async def set_team_scores(
        self, session: AsyncSession, *, match_id: int, discipline: str, scores: Mapping[int, float]
    ) -> None:
        with session.no_autoflush:
            match = await self._match(session, match_id, discipline)
            stat = models.StatDef.__table__
            score_id = await session.scalar(
                sa.select(stat.c.id).where(
                    stat.c.discipline == discipline, stat.c.code == "score", stat.c.active.is_(True)
                )
            )
            if score_id is None:
                raise ValueError("discipline has no active score definition")
            rows = _rows(
                models.StatsFact,
                [
                    {
                        "match_id": match_id,
                        "segment": 0,
                        "encounter_team_id": team,
                        "workspace_member_id": None,
                        "entity_id": None,
                        "stat_id": score_id,
                        "value": value,
                    }
                    for team, value in scores.items()
                ],
                match_id,
            )
            await _validate_facts(session, match, rows, *(await _fact_context(session, match_id)))
        table = models.StatsFact.__table__
        await session.execute(
            sa.delete(table).where(
                table.c.match_id == match_id,
                table.c.stat_id == score_id,
                table.c.segment == 0,
                table.c.workspace_member_id.is_(None),
                table.c.entity_id.is_(None),
                table.c.encounter_team_id.in_(scores),
            )
        )
        await _bulk_insert(session, models.StatsFact, rows)
        await session.flush()

    async def merge_member_history(
        self,
        session: AsyncSession,
        *,
        source_member_id: int,
        target_member_id: int,
    ) -> int:
        """Move disjoint observations without changing their grain or historical metadata."""
        member = models.WorkspaceMember.__table__
        members = dict(
            (
                await session.execute(
                    sa.select(member.c.id, member.c.workspace_id)
                    .where(
                        member.c.id.in_((source_member_id, target_member_id)),
                    )
                    .order_by(member.c.id)
                    .with_for_update()
                )
            ).all()
        )
        if source_member_id == target_member_id:
            raise ValueError("member history requires two distinct members")
        if len(members) != 2 or members[source_member_id] != members[target_member_id]:
            raise ValueError("member history must stay within one workspace")
        player, match = models.StatsMatchPlayer.__table__, models.StatsMatch.__table__
        source_matches = sa.select(player.c.match_id).where(player.c.workspace_member_id == source_member_id)
        owned = (
            await session.execute(
                sa.select(match.c.id, match.c.workspace_id)
                .where(
                    match.c.id.in_(source_matches),
                )
                .order_by(match.c.id)
                .with_for_update()
            )
        ).all()
        if any(workspace_id != members[source_member_id] for _, workspace_id in owned):
            raise ValueError("member observations belong to another workspace")
        if await session.scalar(
            sa.select(
                sa.exists().where(
                    player.c.workspace_member_id == target_member_id,
                    player.c.match_id.in_(source_matches),
                )
            )
        ):
            raise ValueError("stats_member_history_conflict")
        if not owned:
            return 0
        # The source-player FK cascades facts: insert/repoint/delete order is mandatory.
        await session.execute(
            sa.insert(player).from_select(
                ["match_id", "encounter_team_id", "workspace_member_id", "handle_snapshot", "observed_role_id"],
                sa.select(
                    player.c.match_id,
                    player.c.encounter_team_id,
                    sa.literal(target_member_id),
                    player.c.handle_snapshot,
                    player.c.observed_role_id,
                ).where(player.c.workspace_member_id == source_member_id),
            )
        )
        fact, event = models.StatsFact.__table__, models.StatsEvent.__table__
        await session.execute(
            sa.update(fact)
            .where(fact.c.workspace_member_id == source_member_id)
            .values(workspace_member_id=target_member_id)
        )
        for column in (event.c.actor_member_id, event.c.target_member_id):
            await session.execute(
                sa.update(event).where(column == source_member_id).values({column.name: target_member_id})
            )
        await session.execute(sa.delete(player).where(player.c.workspace_member_id == source_member_id))
        await session.flush()
        return len(owned)


def stalled_conditions(
    *,
    now: datetime,
    pending_after_seconds: int,
    processing_after_seconds: int,
) -> sa.ColumnElement[bool]:
    job = models.IngestJob
    last_touch = sa.func.coalesce(job.updated_at, job.created_at)
    return sa.or_(
        sa.and_(
            job.status == models.IngestJobStatus.PENDING, last_touch < now - timedelta(seconds=pending_after_seconds)
        ),
        sa.and_(
            job.status == models.IngestJobStatus.PROCESSING,
            sa.func.coalesce(job.started_at, last_touch) < now - timedelta(seconds=processing_after_seconds),
        ),
    )


class IngestJobRepository:
    async def get(
        self, session: AsyncSession, job_id: int, *, populate_existing: bool = False
    ) -> models.IngestJob | None:
        return await session.get(models.IngestJob, job_id, populate_existing=populate_existing)

    async def get_discipline(self, session: AsyncSession, job_id: int) -> str | None:
        return await session.scalar(sa.select(models.IngestJob.discipline).where(models.IngestJob.id == job_id))

    async def get_workspace_id(self, session: AsyncSession, job_id: int) -> int | None:
        return await session.scalar(sa.select(models.IngestJob.workspace_id).where(models.IngestJob.id == job_id))

    async def verify_raw_source(
        self,
        session: AsyncSession,
        *,
        job_id: int,
        workspace_id: int,
        raw_status: models.RawSourceStatus,
        inspected_sha256: str | None,
    ) -> models.IngestJob:
        """Apply an inspected source result; the caller captures/stages evidence and commits."""
        from shared.services.stats_evidence import verified_content_hash

        with session.no_autoflush:
            job = await self.get_for_update(session, job_id, workspace_id=workspace_id)
            if job is None:
                raise ValueError("unknown ingest job in workspace")
            raw_status = models.RawSourceStatus(raw_status)
            content_hash = verified_content_hash(job.content_hash, raw_status, inspected_sha256)
            if raw_status == models.RawSourceStatus.AVAILABLE:
                source, match = models.IngestJob, models.StatsMatch
                observations = (
                    await session.scalars(
                        sa.select(match.id)
                        .join(source, source.id == match.ingest_job_id)
                        .where(source.workspace_id == workspace_id, source.raw_ref == job.raw_ref)
                        .limit(2)
                    )
                ).all()
                if len(observations) > 1:
                    raise ValueError("shared raw source has ambiguous observation provenance")
            if job.raw_status != raw_status or job.content_hash != content_hash:
                await session.execute(
                    sa.update(models.IngestJob)
                    .where(models.IngestJob.id == job_id, models.IngestJob.workspace_id == workspace_id)
                    .values(raw_status=raw_status, content_hash=content_hash, updated_at=job.updated_at)
                )
        await session.flush()
        return job

    async def update_hints(
        self,
        session: AsyncSession,
        job: models.IngestJob,
        *,
        encounter_id: int,
        encounter_game_id: int | None,
    ) -> None:
        await session.execute(
            sa.update(models.IngestJob)
            .where(models.IngestJob.id == job.id)
            .values(
                hint_encounter_id=encounter_id,
                hint_encounter_game_id=encounter_game_id,
                updated_at=job.updated_at,
            )
        )

    async def create_or_get(
        self,
        session: AsyncSession,
        *,
        workspace_id: int,
        discipline: str,
        source_kind: str,
        external_id: str | None,
        content_hash: str,
        filename: str | None,
        raw_ref: str,
        document_ref: str | None,
        uploader_user_id: int | None,
        api_key_id: int | None,
        hint_tournament_id: int | None,
        hint_encounter_id: int | None,
        hint_encounter_game_id: int | None,
        classify_existing: Callable[[models.IngestJob], Awaitable[Literal["canonical", "raw"]]] | None = None,
    ) -> tuple[models.IngestJob, bool]:
        """Reserve one pending job per idempotency key; ``False`` returns the existing row untouched.

        ``classify_existing`` tells whether an existing row that already has a document was submitted as a canonical
        document or is raw input (the server-authored envelope producer; the service layer owns that S3 read). A row
        without a document is raw. It is required only when a hash-key collision meets a row with a document.

        The key is ``(workspace, source_kind, external_id)`` when an external id is present, otherwise
        ``(workspace, content_hash)`` -- the two partial unique indexes. The caller owns the commit.
        """
        from shared.services.stats_evidence import capture_stats_evidence, owner_scopes, stage_stats_evidence

        job, tournament, encounter, game = models.IngestJob, models.Tournament, models.Encounter, models.EncounterGame
        if (
            not isinstance(content_hash, str)
            or len(content_hash) != 64
            or any(c not in "0123456789abcdef" for c in content_hash)
            or not raw_ref
            or len(raw_ref) > 512
            or (document_ref is not None and not 0 < len(document_ref) <= 512)
            or (filename is not None and not 0 < len(filename) <= 500)
            or not source_kind
            or len(source_kind) > 32
            or (external_id is not None and not 0 < len(external_id) <= 128)
        ):
            raise BaseAPIException(status_code=422, detail="stats_upload_invalid_provenance")
        keyed = external_id is not None
        key_filter = (
            (job.workspace_id == workspace_id, job.source_kind == source_kind, job.external_id == external_id)
            if keyed
            else (job.workspace_id == workspace_id, job.content_hash == content_hash, job.external_id.is_(None))
        )

        async def reuse_or_conflict(row: models.IngestJob) -> models.IngestJob:
            if keyed:
                if row.discipline != discipline or row.content_hash != content_hash:
                    raise BaseAPIException(status_code=409, detail={"code": "idempotency_conflict"})
            else:
                # Upload kinds share one decoder, so the same bytes from another upload channel are the same
                # job; any other kind colliding on a hash must never run a different decoder.
                # Provenance, never key text or an FK that can be nulled: the existing row is canonical iff its
                # server-authored envelope says so (a document-less row is undecoded raw input).
                canonical = document_ref is not None
                if row.document_ref is None:
                    existing_canonical = False
                elif classify_existing is None:
                    raise RuntimeError("an existing row with a document needs classify_existing")
                else:
                    existing_canonical = await classify_existing(row) == "canonical"
                same_kind = row.source_kind == source_kind or (
                    not canonical and {row.source_kind, source_kind} <= UPLOAD_SOURCE_KINDS
                )
                if (
                    row.discipline != discipline
                    or existing_canonical != canonical
                    or not same_kind
                    or (source_kind in UPLOAD_SOURCE_KINDS and row.hint_tournament_id != hint_tournament_id)
                ):
                    raise BaseAPIException(status_code=409, detail="stats_upload_scope_conflict")
            return row

        # Reuse locks only the existing job and never its parents: it writes no
        # foreign key. New inserts lock parents only after ruling out reuse.
        await session.execute(
            sa.text("SELECT pg_advisory_xact_lock(hashtext(:key))"),
            {
                "key": f"stats.ingest:{workspace_id}:{source_kind}:{external_id}"
                if keyed
                else f"stats.upload:{workspace_id}:{content_hash}",
            },
        )
        existing = (
            await session.scalars(
                sa.select(job).where(*key_filter).with_for_update().execution_options(populate_existing=True)
            )
        ).one_or_none()
        if existing is not None:
            await reuse_or_conflict(existing)
        query = sa.select(models.Workspace.id).where(models.Workspace.id == workspace_id)
        if not await session.scalar(query.with_for_update(read=True) if existing is None else query):
            raise BaseAPIException(status_code=422, detail="stats_upload_hint_conflict")
        if hint_tournament_id is not None:
            query = sa.select(tournament.id).where(
                tournament.id == hint_tournament_id,
                tournament.workspace_id == workspace_id,
                tournament.discipline == discipline,
            )
            if not await session.scalar(query.with_for_update(read=True) if existing is None else query):
                raise BaseAPIException(status_code=422, detail="stats_upload_hint_conflict")
        if hint_encounter_id is not None:
            query = sa.select(encounter.id).where(
                encounter.id == hint_encounter_id,
                encounter.workspace_id == workspace_id,
                encounter.discipline == discipline,
            )
            if hint_tournament_id is not None:
                query = query.where(encounter.tournament_id == hint_tournament_id)
            if not await session.scalar(query.with_for_update(read=True) if existing is None else query):
                raise BaseAPIException(status_code=422, detail="stats_upload_hint_conflict")
        if hint_encounter_game_id is not None:
            query = (
                sa.select(game.id)
                .join(encounter, encounter.id == game.encounter_id)
                .where(
                    game.id == hint_encounter_game_id,
                    encounter.workspace_id == workspace_id,
                    encounter.discipline == discipline,
                )
            )
            if hint_tournament_id is not None:
                query = query.where(encounter.tournament_id == hint_tournament_id)
            if hint_encounter_id is not None:
                query = query.where(encounter.id == hint_encounter_id)
            if not await session.scalar(
                query.with_for_update(read=True, of=(game, encounter)) if existing is None else query,
            ):
                raise BaseAPIException(status_code=422, detail="stats_upload_hint_conflict")
        if api_key_id is not None and not await session.scalar(
            sa.select(models.ApiKey.id).where(
                models.ApiKey.id == api_key_id,
                models.ApiKey.workspace_id == workspace_id,
            )
        ):
            raise BaseAPIException(status_code=422, detail="stats_upload_hint_conflict")
        if existing is not None:
            return existing, False
        # Reserve the real identity so evidence can capture its absence before INSERT.
        job_id = await session.scalar(sa.text("SELECT nextval(pg_get_serial_sequence('stats.ingest_job', 'id'))"))
        scopes = owner_scopes("job", (job_id,))
        before = await capture_stats_evidence(session, scopes=scopes)
        inserted = await session.scalar(
            pg_insert(job)
            .values(
                id=job_id,
                workspace_id=workspace_id,
                discipline=discipline,
                source_kind=source_kind,
                external_id=external_id,
                content_hash=content_hash,
                raw_status=models.RawSourceStatus.AVAILABLE,
                filename=filename,
                raw_ref=raw_ref,
                document_ref=document_ref,
                uploader_user_id=uploader_user_id,
                hint_tournament_id=hint_tournament_id,
                hint_encounter_id=hint_encounter_id,
                api_key_id=api_key_id,
                hint_encounter_game_id=hint_encounter_game_id,
                status=models.IngestJobStatus.PENDING,
            )
            .on_conflict_do_nothing(
                index_elements=[job.workspace_id, job.source_kind, job.external_id]
                if keyed
                else [job.workspace_id, job.content_hash],
                index_where=job.external_id.is_not(None) if keyed else job.external_id.is_(None),
            )
            .returning(job.id)
        )
        if inserted is None:
            existing = (await session.scalars(sa.select(job).where(*key_filter).with_for_update())).one()
            return await reuse_or_conflict(existing), False
        await session.flush()
        after = await capture_stats_evidence(session, scopes=scopes)
        await stage_stats_evidence(
            session,
            operation="stats.job_transition",
            before=before,
            after=after,
            workspace_id=workspace_id,
            entity_type="ingest_job",
            entity_id=job_id,
        )
        return (await session.scalars(sa.select(job).where(job.id == job_id))).one(), True

    async def get_for_update(
        self,
        session: AsyncSession,
        job_id: int,
        *,
        workspace_id: int,
    ) -> models.IngestJob | None:
        return (
            await session.scalars(
                sa.select(models.IngestJob)
                .where(
                    models.IngestJob.id == job_id,
                    models.IngestJob.workspace_id == workspace_id,
                )
                .with_for_update()
                .execution_options(populate_existing=True)
            )
        ).one_or_none()

    async def claim_stalled(
        self,
        session: AsyncSession,
        *,
        now: datetime,
        pending_after_seconds: int,
        processing_after_seconds: int,
        limit: int,
        disciplines: Sequence[str] | None = None,
    ) -> Sequence[models.IngestJob]:
        """Lock stalled jobs; ``disciplines`` limits the sweep to the ones this worker runs (``None``: every one)."""
        selected = () if disciplines is None else (models.IngestJob.discipline.in_(disciplines),)
        return (
            await session.scalars(
                sa.select(models.IngestJob)
                .where(
                    stalled_conditions(
                        now=now,
                        pending_after_seconds=pending_after_seconds,
                        processing_after_seconds=processing_after_seconds,
                    ),
                    *selected,
                )
                .order_by(models.IngestJob.created_at, models.IngestJob.id)
                .limit(limit)
                .with_for_update(skip_locked=True)
            )
        ).all()

    async def claim_expired_failed(
        self,
        session: AsyncSession,
        *,
        cutoff: datetime,
        limit: int,
    ) -> Sequence[models.IngestJob]:
        job = models.IngestJob
        return (
            await session.scalars(
                sa.select(job)
                .where(
                    job.status == models.IngestJobStatus.FAILED,
                    job.finished_at < cutoff,
                    ~sa.exists().where(models.StatsMatch.ingest_job_id == job.id),
                )
                .order_by(job.finished_at, job.id)
                .limit(limit)
                .with_for_update(skip_locked=True)
            )
        ).all()

    async def raw_ref_in_use(
        self,
        session: AsyncSession,
        raw_ref: str,
        *,
        exclude_ids: Sequence[int] = (),
    ) -> bool:
        job = models.IngestJob
        return bool(
            await session.scalar(
                sa.select(
                    sa.exists().where(
                        job.raw_ref == raw_ref,
                        sa.or_(
                            job.id.not_in(exclude_ids), sa.exists().where(models.StatsMatch.ingest_job_id == job.id)
                        ),
                    )
                )
            )
        )

    async def document_ref_in_use(
        self,
        session: AsyncSession,
        document_ref: str,
        *,
        exclude_ids: Sequence[int] = (),
    ) -> bool:
        """Whether another job (or a match bound to any job) still needs this immutable envelope."""
        job = models.IngestJob
        return bool(
            await session.scalar(
                sa.select(
                    sa.exists().where(
                        job.document_ref == document_ref,
                        sa.or_(
                            job.id.not_in(exclude_ids), sa.exists().where(models.StatsMatch.ingest_job_id == job.id)
                        ),
                    )
                )
            )
        )

    async def delete_by_ids(self, session: AsyncSession, ids: Sequence[int]) -> None:
        if ids:
            await session.execute(sa.delete(models.IngestJob).where(models.IngestJob.id.in_(ids)))
            await session.flush()
