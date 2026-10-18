"""Idempotent native OW backfill at every non-character segment.

Raw and character facts remain untouched. The existing pandas formula and
current-registration rank/role boundary are frozen (D96); ownership always
comes from match_player, even after a roster change or removal. Each caller's
per-match commit includes complete evidence and tracked JSON fight updates.
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING

import pandas as pd
import sqlalchemy as sa
from loguru import logger

from shared import models
from shared.core import enums
from shared.disciplines.overwatch import baselines as baselines_service
from shared.disciplines.overwatch import impact
from shared.disciplines.overwatch.impact_backfill import (
    NEW_STAT_MEMBERS,
    _merge_events,
    _rank_by_impact,
    rebuild_frames,
)
from shared.repository.stats import StatDefRepository, StatsMatchRepository
from shared.repository.stats_queries import player_facts
from shared.services.stats_evidence import capture_stats_evidence, owner_scopes, stage_stats_evidence

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

__all__ = (
    "MAX_CONSECUTIVE_FAILURES",
    "BackfillService",
    "backfill_all",
    "backfill_match",
    "backfill_service",
)

#: Circuit breaker for ``backfill_all``: abort the run after this many
#: per-match failures IN A ROW (resets on any success). Guards against a
#: systemic bug (e.g. schema/code mismatch) silently burning a multi-hour
#: run over thousands of matches before anyone reads the summary — isolated
#: bad matches below this threshold still just increment ``failed`` and
#: the loop continues.
MAX_CONSECUTIVE_FAILURES = 10


class BackfillService:
    def __init__(self, *, stats_repo: StatsMatchRepository = StatsMatchRepository()) -> None:
        self._stats_repo = stats_repo
        self._hero_types_cache: dict[int, enums.HeroClass] = {}

    def _stat_objects(
        self,
        match_id: int,
        ownership: Mapping[int, tuple[int, int]],
        stat_ids: Mapping[str, int],
        round_df: pd.DataFrame,
        match_df: pd.DataFrame,
    ) -> list[dict]:
        """Build native facts using actual member/participant ownership, never roster teams."""
        objects = []
        for df in (round_df, match_df):
            for _, row in df.iterrows():
                member_id, team_id = ownership[int(row["user_id"])]
                for member in NEW_STAT_MEMBERS:
                    raw = row.get(member, 0.0)
                    objects.append(
                        {
                            "match_id": match_id,
                            "segment": int(row["round"]),
                            "encounter_team_id": team_id,
                            "workspace_member_id": member_id,
                            "entity_id": None,
                            "stat_id": stat_ids[member.value],
                            "value": 0.0 if pd.isna(raw) else float(raw),
                        }
                    )
        return objects

    async def _load_stat_rows(self, session: AsyncSession, match_id: int) -> pd.DataFrame:
        f = player_facts(discipline="overwatch").c
        result = await session.execute(
            sa.select(
                f.player_id.label("user_id"),
                f.segment.label("round"),
                f.entity_id.label("hero_id"),
                f.stat_code.label("name"),
                f.value,
            ).where(f.match_id == match_id, f.stat_code.not_in([member.value for member in NEW_STAT_MEMBERS]))
        )
        rows = result.mappings().all()
        if not rows:
            return pd.DataFrame(columns=["user_id", "round", "hero_id", "name", "value"])
        df = pd.DataFrame(rows)
        df["name"] = df["name"].map(enums.LogStatsName)
        return df

    async def _load_players(self, session: AsyncSession, match_id: int):
        """All observed players, including event-only and no-longer-rostered members."""
        player, match, member = models.StatsMatchPlayer, models.StatsMatch, models.WorkspaceMember
        team, game, encounter = models.EncounterTeam, models.EncounterGame, models.Encounter
        return (
            await session.execute(
                sa.select(
                    member.player_id.label("user_id"),
                    player.workspace_member_id,
                    player.encounter_team_id,
                    team.team_id,
                )
                .select_from(player)
                .join(match, match.id == player.match_id)
                .join(
                    member,
                    sa.and_(member.id == player.workspace_member_id, member.workspace_id == match.workspace_id),
                )
                .join(game, game.id == match.encounter_game_id)
                .join(
                    encounter,
                    sa.and_(
                        encounter.id == game.encounter_id,
                        encounter.workspace_id == match.workspace_id,
                        encounter.discipline == match.discipline,
                    ),
                )
                .join(team, sa.and_(team.id == player.encounter_team_id, team.encounter_id == encounter.id))
                .where(
                    match.id == match_id,
                    match.discipline == "overwatch",
                )
            )
        ).all()

    async def _load_kills(self, session: AsyncSession, match_id: int) -> list[models.StatsEvent]:
        event, match, kind = models.StatsEvent, models.StatsMatch, models.EventType
        return list(
            await session.scalars(
                sa.select(event)
                .join(match, match.id == event.match_id)
                .join(
                    kind,
                    kind.id == event.type_id,
                )
                .where(
                    event.match_id == match_id,
                    match.discipline == "overwatch",
                    kind.discipline == "overwatch",
                    kind.code == "kill",
                )
                .order_by(event.t, event.id)
            )
        )

    async def _load_hero_types(self, session: AsyncSession) -> dict[int, enums.HeroClass]:
        if not self._hero_types_cache:
            rows = (
                await session.execute(
                    sa.select(
                        models.CatalogEntity.id,
                        models.CatalogEntity.attrs["class"].astext.label("hero_class"),
                    ).where(models.CatalogEntity.discipline == "overwatch", models.CatalogEntity.kind == "character")
                )
            ).all()
            self._hero_types_cache.update({row.id: enums.HeroClass[row.hero_class] for row in rows})
        return self._hero_types_cache

    async def _load_player_refs(self, session: AsyncSession, match_id: int) -> dict[int, impact.PlayerRef]:
        """Frozen current-registration scoring inputs, anchored to historical ownership."""
        f = player_facts(discipline="overwatch").c
        fact_users = set(await session.scalars(sa.select(f.player_id).where(f.match_id == match_id).distinct()))
        owners = [row for row in await self._load_players(session, match_id) if row.user_id in fact_users]
        if not owners:
            return {}
        hero_types = await self._load_hero_types(session)
        playtime_rows = (
            await session.execute(
                sa.select(
                    f.player_id.label("user_id"),
                    f.entity_id.label("hero_id"),
                    f.value,
                ).where(
                    f.match_id == match_id,
                    f.segment == 0,
                    f.entity_id.is_not(None),
                    f.stat_code == enums.LogStatsName.HeroTimePlayed.value,
                )
            )
        ).all()
        playtime_df = pd.DataFrame(
            {
                "player_id": [r.user_id for r in playtime_rows],
                "hero_id": [r.hero_id for r in playtime_rows],
                "seconds": [r.value for r in playtime_rows],
            }
        )
        dominant_roles = impact.dominant_roles(playtime_df, hero_types)
        roster_ranked = (
            sa.select(
                models.Player.team_id,
                models.Player.workspace_member_id,
                models.Player.role.label("role"),
                models.Player.rank,
                sa.func.row_number()
                .over(
                    partition_by=(models.Player.team_id, models.Player.workspace_member_id),
                    order_by=(models.Player.is_substitution.asc(), models.Player.id.desc()),
                )
                .label("roster_rank"),
            )
            .join(models.Tournament, models.Tournament.id == models.Player.tournament_id)
            .where(
                models.Player.team_id.in_({row.team_id for row in owners}),
                models.Tournament.discipline == "overwatch",
            )
            .subquery("backfill_roster_ranked")
        )
        roster_rows = (await session.execute(sa.select(roster_ranked).where(roster_ranked.c.roster_rank == 1))).all()
        roster_by_key = {
            (row.team_id, row.workspace_member_id): (
                enums.HeroClass[row.role] if row.role else None,
                row.rank,
            )
            for row in roster_rows
        }
        refs = {}
        for owner in owners:
            entry = roster_by_key.get((owner.team_id, owner.workspace_member_id))
            declared_role, rank = entry if entry is not None else (None, 0)
            role = (dominant_roles.get(owner.user_id) or declared_role) if entry is not None else None
            refs[owner.user_id] = impact.PlayerRef(
                player_id=owner.user_id,
                user_id=owner.user_id,
                team_id=owner.team_id,
                role=role,
                rank=rank,
            )
        return refs

    async def backfill_match(self, session: AsyncSession, match_id: int) -> bool:
        """Recompute seven codes and fights; flush/evidence here, commit in the caller."""
        match = await session.scalar(
            sa.select(models.StatsMatch)
            .where(
                models.StatsMatch.id == match_id,
                models.StatsMatch.discipline == "overwatch",
            )
            .with_for_update()
        )
        if match is None:
            return False
        stat_rows = await self._load_stat_rows(session, match_id)
        if stat_rows.empty:
            return False
        scopes = owner_scopes("match", (match_id,))
        before = await capture_stats_evidence(session, scopes=scopes)
        kill_feed = await self._load_kills(session, match_id)
        impact.assign_fights(kill_feed)
        players = await self._load_players(session, match_id)
        member_user_ids = {row.workspace_member_id: row.user_id for row in players}
        ownership = {row.user_id: (row.workspace_member_id, row.encounter_team_id) for row in players}
        refs = await self._load_player_refs(session, match_id)
        hero_types = await self._load_hero_types(session)
        baselines = await baselines_service.get_active(session, discipline="overwatch")
        if baselines is None:
            raise RuntimeError("Impact baselines are not computed — run recompute first")
        round_df, match_df = rebuild_frames(stat_rows)
        has_killfeed = bool(kill_feed)
        events_df = impact.build_event_counts(kill_feed, hero_types, member_user_ids=member_user_ids)
        round_df, match_df = _merge_events(round_df, match_df, events_df)
        round_scored = _rank_by_impact(
            impact.add_impact_scores(round_df, players=refs, baselines=baselines, has_killfeed=has_killfeed)
        )
        match_scored = _rank_by_impact(
            impact.add_impact_scores(match_df, players=refs, baselines=baselines, has_killfeed=has_killfeed)
        )
        stat_ids = await StatDefRepository().ids(session, discipline="overwatch")
        objects = self._stat_objects(match_id, ownership, stat_ids, round_scored, match_scored)
        await self._stats_repo.replace_fact_codes(
            session,
            match_id=match_id,
            discipline="overwatch",
            stat_codes=[member.value for member in NEW_STAT_MEMBERS],
            rows=objects,
        )
        await session.flush()
        after = await capture_stats_evidence(session, scopes=scopes)
        if before != after:
            await stage_stats_evidence(
                session,
                operation="stats.derived_backfill",
                before=before,
                after=after,
                workspace_id=match.workspace_id,
                entity_type="stats_match",
                entity_id=match_id,
            )
        return True

    async def backfill_all(
        self,
        session_factory: async_sessionmaker[AsyncSession],
        tournament_id: int | None = None,
    ) -> dict[str, int]:
        """Backfill every match with existing stats (optionally scoped to one tournament).

        Commits once per match, so a mid-run failure only loses the in-flight
        match — ``backfill_match``'s delete-then-insert is idempotent per match,
        so rerunning after a fix safely reprocesses everything from the start.

        Raises ``RuntimeError`` if ``MAX_CONSECUTIVE_FAILURES`` matches fail in a
        row — that pattern indicates a systemic bug (e.g. a schema/code
        mismatch that fails every match), not isolated bad data, so the run
        aborts fast instead of burning hours over thousands of matches before
        anyone reads the summary. The consecutive-failure counter resets on any
        success (processed or skipped); the total ``failed`` count keeps
        accumulating for genuinely-isolated bad matches under the threshold.
        """
        async with session_factory() as session:
            if await baselines_service.get_active(session, discipline="overwatch") is None:
                raise RuntimeError("Impact baselines are not computed — run recompute first")

            query = (
                sa.select(models.StatsMatch.id)
                .join(
                    models.EncounterGame,
                    models.EncounterGame.id == models.StatsMatch.encounter_game_id,
                )
                .join(
                    models.Encounter,
                    sa.and_(
                        models.Encounter.id == models.EncounterGame.encounter_id,
                        models.Encounter.workspace_id == models.StatsMatch.workspace_id,
                        models.Encounter.discipline == models.StatsMatch.discipline,
                    ),
                )
                .where(models.StatsMatch.discipline == "overwatch")
            )
            if tournament_id is not None:
                query = query.where(models.Encounter.tournament_id == tournament_id)
            match_ids = (await session.execute(query.order_by(models.StatsMatch.id))).scalars().all()

        total = len(match_ids)
        processed = 0
        skipped = 0
        failed = 0
        logger.info(
            f"Impact backfill starting: {total} matches"
            + (f" (tournament_id={tournament_id})" if tournament_id is not None else "")
        )

        consecutive_failures = 0
        for i, match_id in enumerate(match_ids, start=1):
            try:
                async with session_factory() as session:
                    did_backfill = await self.backfill_match(session, match_id)
                    await session.commit()
            except Exception:
                logger.exception(f"Impact backfill failed for match_id={match_id}")
                failed += 1
                consecutive_failures += 1
                if consecutive_failures >= MAX_CONSECUTIVE_FAILURES:
                    summary = {"total": total, "processed": processed, "skipped": skipped, "failed": failed}
                    logger.error(f"Impact backfill aborting: {summary}")
                    raise RuntimeError(
                        f"Impact backfill aborted after {consecutive_failures} consecutive failures "
                        f"(most recently match_id={match_id}) — likely a systemic bug, not isolated "
                        f"bad matches; summary so far: {summary}"
                    )
                continue
            else:
                consecutive_failures = 0

            if did_backfill:
                processed += 1
            else:
                skipped += 1

            if i % 100 == 0:
                logger.info(
                    f"Impact backfill progress: {i}/{total} processed={processed} skipped={skipped} failed={failed}"
                )

        summary = {"total": total, "processed": processed, "skipped": skipped, "failed": failed}
        logger.info(f"Impact backfill done: {summary}")
        return summary


backfill_service = BackfillService()

backfill_match = backfill_service.backfill_match
backfill_all = backfill_service.backfill_all
