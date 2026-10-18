"""Real-database fixtures for the binding and replacement tests (Task 4).

Everything here inserts actual models and flushes: workspace, catalog vocabulary, tournament, encounter, seats, rosters,
users with social identities and workspace anchors, games, and a valid canonical document that names exactly those
people. Nothing substitutes a service result; ``observation_snapshot`` reads the native tables back by natural key.
"""

from __future__ import annotations

import copy
import hashlib
import json
import random
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.ext.asyncio import AsyncSession

from shared import models
from shared.core import enums
from shared.disciplines import DISCIPLINES
from shared.repository.roles import CatalogRoleRepository
from shared.repository.stats import IngestJobRepository
from shared.schemas.match_doc import MatchDoc
from src.services.ingest.jobs import raw_ref_for, store_document

OW_STATS = ("score", "eliminations")
OW_EVENT = "kill"


@dataclass
class IngestCase:
    workspace_id: int
    tournament_id: int
    encounter_id: int
    game_id: int
    map_id: int
    map_code: str
    hero_code: str
    discipline: str
    slug: str
    #: encounter.team ids in slot order
    team_ids: list[int]
    #: per team: workspace member ids / global player ids / battlenet handles, in roster order
    member_ids: list[list[int]]
    player_ids: list[list[int]]
    handles: list[list[str]]
    scoring_rule_id: int
    role: dict[str, str]
    provider: str
    stat_codes: tuple[str, ...]
    event_code: str | None
    document: dict[str, Any] = field(default_factory=dict)


def team_key(index: int) -> str:
    return f"t{index + 1}"


def participant_key(team: int, index: int) -> str:
    return f"p{team + 1}{index + 1}"


def build_document(case: IngestCase, *, external_id: str | None = None, **changes: Any) -> dict[str, Any]:
    """A valid canonical document for the case's rosters: team ``i`` has placement ``i + 1``."""
    teams = [{"key": team_key(i), "placement": i + 1} for i in range(len(case.team_ids))]
    participants = [
        {
            "key": participant_key(t, i),
            "team": team_key(t),
            "identity": {"provider": case.provider, "id": handle},
            "role": dict(case.role),
        }
        for t, handles in enumerate(case.handles)
        for i, handle in enumerate(handles)
    ]
    facts: list[dict[str, Any]] = []
    if case.stat_codes:
        first, second = case.stat_codes
        facts = [
            {"team": team_key(t), "stat": first, "value": len(case.team_ids) - t} for t in range(len(case.team_ids))
        ]
        facts += [
            {"participant": participant_key(t, i), "stat": second, "value": 3 + i + t, "entity": case.hero_code}
            for t, handles in enumerate(case.handles)
            for i, _ in enumerate(handles)
        ]
    events = (
        [
            {
                "t": 10,
                "type": case.event_code,
                "actor": participant_key(0, 0),
                "target": participant_key(1, 0),
                "entity": case.hero_code,
                "segment": 1,
            }
        ]
        if case.event_code
        else []
    )
    doc: dict[str, Any] = {
        "protocol": "owt.match/1",
        "discipline": case.discipline,
        "source": {"kind": "external", "external_id": external_id or f"seed-{case.slug}"},
        "played_at": "2026-10-15T12:00:00Z",
        "duration_s": 600,
        "map": case.map_code,
        "teams": teams,
        "participants": participants,
        "segments": [{"index": 1, "kind": "round", "attrs": {}}],
        "facts": facts,
        "events": events,
    }
    doc.update(copy.deepcopy(changes))
    return doc


def shuffled(document: dict[str, Any], seed: int) -> dict[str, Any]:
    """The same document with its team and participant arrays reordered (keys and values untouched)."""
    rng = random.Random(seed)
    out = copy.deepcopy(document)
    for name in ("teams", "participants"):
        rng.shuffle(out[name])
    return out


async def seed_ingest_case(
    session: AsyncSession,
    *,
    teams: int = 2,
    workspace_slug: str,
    discipline: str = "overwatch",
    players_per_team: int = 3,
    workspace_id: int | None = None,
) -> IngestCase:
    """Workspace + vocabulary + tournament + encounter with ``teams`` seats, rosters and one planned game.

    ``workspace_id`` seeds into a workspace that already exists (e.g. one the identity service created, with real
    roles and API keys); ``workspace_slug`` then only labels the generated rows.
    """
    spec = DISCIPLINES[discipline]
    provider = spec.identity_provider
    tag = hashlib.sha1(workspace_slug.encode()).hexdigest()[:8]  # noqa: S324 - a label
    if workspace_id is None:
        workspace = models.Workspace(
            slug=workspace_slug, name=f"Seed {workspace_slug}", disciplines_enabled=[discipline]
        )
        session.add(workspace)
        await session.flush()
    else:
        workspace = await session.get_one(models.Workspace, workspace_id)

    map_ = models.CatalogEntity(discipline=discipline, kind="map", slug=f"map-{tag}", name=f"Map {tag}", attrs={})
    hero = models.CatalogEntity(
        discipline=discipline, kind="character", slug=f"hero-{tag}", name=f"Hero {tag}", attrs={"class": "support"}
    )
    session.add_all([map_, hero])
    tournament = models.Tournament(
        workspace_id=workspace.id, discipline=discipline, name=f"Seed cup {tag}", slug=f"seed-cup-{tag}"
    )
    rule = models.ScoringRule(
        workspace_id=workspace.id,
        preset="wins",
        game_formula="win",
        end_formula="games >= best_of or max_wins * 2 > best_of",
    )
    session.add_all([tournament, rule])
    await session.flush()
    encounter = models.Encounter(
        workspace_id=workspace.id,
        discipline=discipline,
        tournament_id=tournament.id,
        scoring_rule_id=rule.id,
        name="Seed series",
        slot_count=teams,
        status=enums.EncounterStatus.OPEN,
    )
    session.add(encounter)
    await session.flush()

    ontology = await CatalogRoleRepository().ontology(session, discipline=discipline, workspace_id=workspace.id)
    rated = ontology.rated
    node = ontology.roots(rated.code)[0]
    role = {"dimension": rated.code, "role": node.code}
    if discipline == "overwatch":
        stat_codes, event_code = OW_STATS, OW_EVENT
    else:
        stat_codes = tuple(
            await session.scalars(
                sa.select(models.StatDef.code)
                .where(models.StatDef.discipline == discipline, models.StatDef.active.is_(True))
                .order_by(models.StatDef.code)
                .limit(2)
            )
        )
        if len(stat_codes) < 2:
            stat_codes = ()
        event_code = await session.scalar(
            sa.select(models.EventType.code)
            .where(models.EventType.discipline == discipline, models.EventType.active.is_(True))
            .order_by(models.EventType.code)
            .limit(1)
        )

    seats: list[models.EncounterTeam] = []
    for index in range(teams):
        seat = models.EncounterTeam(
            encounter_id=encounter.id,
            tournament_id=tournament.id,
            slot=index + 1,
            name=f"Team {index + 1}",
            active=True,
        )
        session.add(seat)
        seats.append(seat)
    await session.flush()

    member_ids: list[list[int]] = []
    player_ids: list[list[int]] = []
    handles: list[list[str]] = []
    for t, seat in enumerate(seats):
        team_members, team_players, team_handles = [], [], []
        for i in range(players_per_team):
            handle = f"S{tag[:6]}x{t + 1}{i + 1}#{1000 + t * 10 + i}"
            user = models.User(name=f"{workspace_slug}-t{t + 1}p{i + 1}")
            session.add(user)
            await session.flush()
            session.add(
                models.SocialAccount(
                    user_id=user.id,
                    provider=provider,
                    username=handle,
                    username_normalized=handle.lower(),
                    is_primary=True,
                )
            )
            member = models.WorkspaceMember(workspace_id=workspace.id, player_id=user.id)
            session.add(member)
            await session.flush()
            row = models.EncounterTeamMember(
                encounter_id=encounter.id,
                encounter_team_id=seat.id,
                active=True,
                workspace_member_id=member.id,
                display_name_snapshot=user.name,
                rank=800,
            )
            session.add(row)
            await session.flush()
            session.add(models.EncounterTeamMemberRole(team_member_id=row.id, dimension_id=rated.id, role_id=node.id))
            team_members.append(member.id)
            team_players.append(user.id)
            team_handles.append(handle)
        member_ids.append(team_members)
        player_ids.append(team_players)
        handles.append(team_handles)

    case = IngestCase(
        workspace_id=workspace.id,
        tournament_id=tournament.id,
        encounter_id=encounter.id,
        game_id=0,
        map_id=map_.id,
        map_code=map_.slug,
        hero_code=hero.slug,
        discipline=discipline,
        slug=tag,
        team_ids=[seat.id for seat in seats],
        member_ids=member_ids,
        player_ids=player_ids,
        handles=handles,
        scoring_rule_id=rule.id,
        role=role,
        provider=provider,
        stat_codes=stat_codes,
        event_code=event_code,
    )
    case.game_id = await add_game(session, case)
    case.document = build_document(case)
    await session.flush()
    return case


async def add_game(
    session: AsyncSession, case: IngestCase, *, map_id: int | None = None, position: int | None = None
) -> int:
    """Another planned game of the same series between the same seats (a repeat on the same map by default)."""
    taken = await session.scalar(
        sa.select(sa.func.coalesce(sa.func.max(models.EncounterGame.position), 0)).where(
            models.EncounterGame.encounter_id == case.encounter_id
        )
    )
    game = models.EncounterGame(
        encounter_id=case.encounter_id,
        position=position or taken + 1,
        map_id=map_id or case.map_id,
        state=enums.EncounterGameState.PLANNED,
    )
    session.add(game)
    await session.flush()
    session.add_all(
        models.EncounterGameTeam(game_id=game.id, encounter_id=case.encounter_id, encounter_team_id=seat)
        for seat in case.team_ids
    )
    await session.flush()
    return game.id


async def create_job(
    session: AsyncSession,
    s3: Any,
    case: IngestCase,
    document: dict[str, Any] | None = None,
    *,
    external_id: str | None = None,
    hint: dict[str, int] | None = None,
) -> int:
    """A pending canonical job exactly as ``submit_document`` leaves it (raw bytes, envelope, job row), committed."""
    document = copy.deepcopy(document or case.document)
    if external_id is not None:
        document["source"] = {**document["source"], "external_id": external_id}
    if hint is not None:
        document["hint"] = hint
    doc = MatchDoc.model_validate(document)
    raw = json.dumps(document, sort_keys=True, separators=(",", ":")).encode()
    sha = hashlib.sha256(raw).hexdigest()
    raw_ref = raw_ref_for(case.workspace_id, sha)
    await s3.put_object(raw_ref, raw)
    document_ref = await store_document(s3, workspace_id=case.workspace_id, doc=doc, producer="canonical")
    hints = doc.hint
    job, _ = await IngestJobRepository().create_or_get(
        session,
        workspace_id=case.workspace_id,
        discipline=case.discipline,
        source_kind=doc.source.kind,
        external_id=doc.source.external_id,
        content_hash=sha,
        filename=f"seed-{sha[:12]}.json",
        raw_ref=raw_ref,
        document_ref=document_ref,
        uploader_user_id=None,
        api_key_id=None,
        hint_tournament_id=hints.tournament_id if hints else None,
        hint_encounter_id=hints.encounter_id if hints else None,
        hint_encounter_game_id=hints.encounter_game_id if hints else None,
    )
    job_id = job.id
    await session.commit()
    return job_id


async def observation_snapshot(session: AsyncSession, game_id: int) -> dict[str, Any]:
    """The game's match revision plus every native child row, ordered by natural key. ``{}`` without a match."""
    session.expire_all()
    match = await session.scalar(sa.select(models.StatsMatch).where(models.StatsMatch.encounter_game_id == game_id))
    if match is None:
        return {}

    async def rows(model, *order):
        result = await session.execute(sa.select(model.__table__).where(model.__table__.c.match_id == match.id))
        keyed = [dict(row._mapping) for row in result]
        return sorted(keyed, key=lambda row: tuple(str(row[name]) for name in order))

    return {
        "match_id": match.id,
        "revision": match.revision,
        "ingest_job_id": match.ingest_job_id,
        "duration_s": match.duration_s,
        "teams": await rows(models.StatsMatchTeam, "source_position"),
        "players": await rows(models.StatsMatchPlayer, "workspace_member_id"),
        "segments": await rows(models.StatsSegment, "segment"),
        "facts": await rows(
            models.StatsFact, "segment", "encounter_team_id", "workspace_member_id", "entity_id", "stat_id"
        ),
        "events": await rows(models.StatsEvent, "t", "type_id", "actor_member_id", "target_member_id", "id"),
    }


async def count_revision_events(session: AsyncSession, match_id: int, revision: int) -> int:
    """``match.ingested`` outbox rows of that exact revision."""
    return await session.scalar(
        sa.select(sa.func.count())
        .select_from(models.EventOutbox)
        .where(models.EventOutbox.event_id == f"match.ingested:{match_id}:{revision}")
    )


async def success_events(session: AsyncSession, workspace_id: int) -> int:
    """Everything a successful publication stages and an awaiting/failed job must not: match and achievement events."""
    return await session.scalar(
        sa.select(sa.func.count())
        .select_from(models.EventOutbox)
        .where(
            sa.or_(
                models.EventOutbox.event_type == "match_ingested",
                sa.cast(models.EventOutbox.payload_json["changed_tables"], JSONB).contains(["stats.match"]),
            ),
            models.EventOutbox.payload_json["workspace_id"].as_integer() == workspace_id,
        )
    )


async def side_effects(session: AsyncSession, workspace_id: int) -> dict[str, int]:
    """Row counts an unbound document must leave at zero: observations, virtual players, social accounts, anchors."""

    async def count(model, *where):
        return await session.scalar(sa.select(sa.func.count()).select_from(model).where(*where))

    return {
        "matches": await count(models.StatsMatch, models.StatsMatch.workspace_id == workspace_id),
        "members": await count(models.WorkspaceMember, models.WorkspaceMember.workspace_id == workspace_id),
        "users": await count(models.User),
        "accounts": await count(models.SocialAccount),
        "success_events": await success_events(session, workspace_id),
    }


def now() -> datetime:
    return datetime.now(UTC)
