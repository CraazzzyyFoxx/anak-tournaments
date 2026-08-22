"""Idempotent history backfill for MVP impact scoring (spec 2026-07-10).

Task 5 wired ``impact.py`` into the *live* match-log pipeline. This module
recomputes the same 7 derived stats (the 4 ``EVENT_STATS`` + ImpactPoints /
ImpactRank / OverperformanceScore) for matches that were already ingested
before that wiring existed — or whenever the baseline set / formula changes
and history needs to be rescored.

The pure pivot-rebuilding core (``rebuild_frames`` and its ``_pivot``/
``_merge_events``/``_rank_by_impact`` helpers) lives in
``src.domain.match_logs.impact_backfill`` — it turns the OLD stat rows already
stored for a match back into the same two MVP pivots (round-discrete and
match-total) that the live pipeline builds from the raw log. Everything here
is IO — reading rosters/kill-feed/baselines and writing the 7 derived stats
back — and is exercised at rollout (see Task 10 runbook), not by unit tests,
since it needs a live database.

Idempotency contract (a rerun must produce byte-identical rows):

* ``rebuild_frames`` only ever reads OLD stat rows: it drops per-hero rows
  (``hero_id`` not null) and any of the 7 already-derived stats, so a
  previous backfill's output is never fed back in as input.
* ``backfill_match`` recomputes the kill-feed event counts fresh every call
  (``impact.build_event_counts``) rather than reading previously-persisted
  event rows.
* ``backfill_match`` deletes every existing row named one of the 7 derived
  stats for the match *before* inserting the freshly computed set, so a
  rerun replaces rather than accumulates.
* ``backfill_match`` also recomputes ``kill_feed.fight`` in place
  (``impact.assign_fights``: round-aware, >15s gap) before deriving event
  counts, so first_picks/first_deaths reflect the current fight rule. It is
  deterministic, so a rerun re-derives identical fight ids.

Scoring itself is not reimplemented here — the rebuilt pivots + the merged
event columns are fed straight into ``impact.add_impact_scores`` and ranked
with the exact same ``sort_values`` / ``groupby("round").cumcount()``
recipe Task 5 uses, so backfilled scores match live-pipeline scores for the
same inputs. Backfill has no roster ``Player.id`` to key by (a historical
match may have since been re-rostered/substituted); it keys everything by
``user_id`` instead, and ``PlayerRef.player_id == PlayerRef.user_id``.
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING

import pandas as pd
import sqlalchemy as sa
from loguru import logger

from shared.repository.match_logs import MatchKillFeedRepository, MatchStatisticsRepository
from src import models
from src.core import enums
from src.domain.match_logs import impact
from src.domain.match_logs.impact_backfill import NEW_STAT_MEMBERS, _merge_events, _rank_by_impact, rebuild_frames
from src.services.baselines import service as baselines_service

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
    def __init__(
        self,
        *,
        stats_repo: MatchStatisticsRepository = MatchStatisticsRepository(),
        kill_feed_repo: MatchKillFeedRepository = MatchKillFeedRepository(),
    ) -> None:
        self._stats_repo = stats_repo
        self._kill_feed_repo = kill_feed_repo
        # Per-process cache of hero_id -> HeroClass; heroes are effectively
        # static reference data, so one load per worker process is enough
        # (mirrors the "кэшируемо на процесс" note in the task brief).
        self._hero_types_cache: dict[int, enums.HeroClass] = {}

    def _stat_objects(
        self,
        match_id: int,
        refs: Mapping[int, impact.PlayerRef],
        round_df: pd.DataFrame,
        match_df: pd.DataFrame,
    ) -> list[models.MatchStatistics]:
        """Build MatchStatistics rows for the 7 derived stats straight from the scored pivots.

        Built directly (no ``_create_stat_object`` here — that helper is bound to
        an ORM ``Player`` row the backfill doesn't have).
        """
        objects: list[models.MatchStatistics] = []
        for df in (round_df, match_df):
            for _, row in df.iterrows():
                ref = refs.get(int(row["user_id"]))
                if ref is None:
                    continue
                round_value = int(row["round"])
                for member in NEW_STAT_MEMBERS:
                    raw = row.get(member, 0.0)
                    value = 0.0 if pd.isna(raw) else float(raw)
                    objects.append(
                        models.MatchStatistics(
                            match_id=match_id,
                            round=round_value,
                            team_id=ref.team_id,
                            user_id=ref.user_id,
                            hero_id=None,
                            name=member,
                            value=value,
                        )
                    )
        return objects

    async def _load_stat_rows(self, session: AsyncSession, match_id: int) -> pd.DataFrame:
        """Read a match's OLD ``matches.statistics`` rows (excluding the 7 derived stats).

        UNTESTED here (needs a live DB) — verified at rollout (Task 10 runbook).
        """
        result = await session.execute(
            sa.select(
                models.MatchStatistics.user_id,
                models.MatchStatistics.round,
                models.MatchStatistics.hero_id,
                models.MatchStatistics.name,
                models.MatchStatistics.value,
            ).where(
                models.MatchStatistics.match_id == match_id,
                models.MatchStatistics.name.notin_(NEW_STAT_MEMBERS),
            )
        )
        rows = result.mappings().all()
        if not rows:
            return pd.DataFrame(columns=["user_id", "round", "hero_id", "name", "value"])
        df = pd.DataFrame(rows)
        # The ORM-typed select above already deserializes `name` to LogStatsName
        # members (Enum(LogStatsName) column) — normalize defensively in case a
        # future caller ever swaps in a raw-SQL/string-returning path (see
        # lesson_sqlalchemy_enum_stores_name).
        df["name"] = df["name"].map(lambda n: n if isinstance(n, enums.LogStatsName) else enums.LogStatsName[n])
        return df

    async def _load_hero_types(self, session: AsyncSession) -> dict[int, enums.HeroClass]:
        """{hero.id: hero.type}, cached for the life of the process."""
        if not self._hero_types_cache:
            rows = (await session.execute(sa.select(models.Hero.id, models.Hero.type))).all()
            self._hero_types_cache.update({row.id: row.type for row in rows})
        return self._hero_types_cache

    async def _load_player_refs(self, session: AsyncSession, match_id: int) -> dict[int, impact.PlayerRef]:
        """user_id -> PlayerRef for one match.

        UNTESTED here (needs a live DB) — verified at rollout. Schema assumptions
        (flagged for rollout verification, mirroring ``baselines.flows._load_stats_frame``):

        * ``team_id`` per user is read from the match's OWN (pre-existing)
          ``matches.statistics`` rows, NOT re-derived from the current roster —
          a re-run must never disagree with the ``team_id`` already stored on
          the untouched OLD stat rows for the same match (idempotency /
          consistency with historical data, even across a later substitution).
        * "Dominant role" = the ``overwatch.hero.type`` with the most summed
          round-0 per-hero ``HeroTimePlayed`` seconds for that (match, user) —
          mirrors ``impact.dominant_roles``, matching what Task 5 scores
          against. Falls back to the declared ``tournament.player.role`` when
          no dominant role can be derived (e.g. a match with no per-hero
          playtime rows).
        * ``rank`` comes from the ``tournament.player`` row for the exact
          ``(team_id, user_id)`` pair (``user_id`` = ``workspace_member.player_id``).
          If more than one ``Player`` row exists for the same team+identity
          (substitution edge case), the non-substitute / most-recent row wins
          (same tie-break as Task 4) — unverified against production data. If
          NO roster row exists at all for a (team_id, user_id) pair found in the
          match's own stat rows (stale/orphaned roster data), role/rank fall
          back to ``None``/``0`` rather than dropping the player — unverified
          edge case, flagged for rollout.
        """
        team_rows = (
            await session.execute(
                sa.select(models.MatchStatistics.user_id, models.MatchStatistics.team_id)
                .where(models.MatchStatistics.match_id == match_id)
                .distinct()
            )
        ).all()
        team_by_user: dict[int, int] = {row.user_id: row.team_id for row in team_rows}
        if not team_by_user:
            return {}

        hero_types = await self._load_hero_types(session)
        playtime_rows = (
            await session.execute(
                sa.select(
                    models.MatchStatistics.user_id,
                    models.MatchStatistics.hero_id,
                    models.MatchStatistics.value,
                ).where(
                    models.MatchStatistics.match_id == match_id,
                    models.MatchStatistics.round == 0,
                    models.MatchStatistics.hero_id.is_not(None),
                    models.MatchStatistics.name == enums.LogStatsName.HeroTimePlayed,
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

        team_ids = list(set(team_by_user.values()))
        roster_ranked = (
            sa.select(
                models.Player.team_id.label("team_id"),
                models.WorkspaceMember.player_id.label("user_id"),
                models.Player.role.label("role"),
                models.Player.rank.label("rank"),
                sa.func.row_number()
                .over(
                    partition_by=(models.Player.team_id, models.WorkspaceMember.player_id),
                    order_by=(models.Player.is_substitution.asc(), models.Player.id.desc()),
                )
                .label("roster_rank"),
            )
            .select_from(
                sa.join(
                    models.Player,
                    models.WorkspaceMember,
                    models.WorkspaceMember.id == models.Player.workspace_member_id,
                )
            )
            .where(models.Player.team_id.in_(team_ids))
            .subquery("backfill_roster_ranked")
        )
        roster_rows = (
            await session.execute(
                sa.select(
                    roster_ranked.c.team_id,
                    roster_ranked.c.user_id,
                    roster_ranked.c.role,
                    roster_ranked.c.rank,
                ).where(roster_ranked.c.roster_rank == 1)
            )
        ).all()
        roster_by_key: dict[tuple[int, int], tuple[enums.HeroClass | None, int]] = {
            (row.team_id, row.user_id): (row.role, row.rank) for row in roster_rows
        }

        refs: dict[int, impact.PlayerRef] = {}
        for user_id, team_id in team_by_user.items():
            roster_entry = roster_by_key.get((team_id, user_id))
            has_roster = roster_entry is not None
            declared_role, rank = roster_entry if has_roster else (None, 0)
            # Only trust a dominant/declared role when a roster row actually
            # exists for this (team_id, user_id) pair. Without a roster row,
            # `rank` is meaningless (0), so leaking a role through here would
            # make `add_impact_scores` score the player against baseline
            # bucket 0 (elite/top) via `baselines.bucket_for(0)` — role=None
            # is what routes the player to the safe zero-score path instead
            # (impact.py zeroes both ImpactPoints and OverperformanceScore
            # when role is None).
            role = (dominant_roles.get(user_id) or declared_role) if has_roster else None
            refs[user_id] = impact.PlayerRef(
                player_id=user_id,
                user_id=user_id,
                team_id=team_id,
                role=role,
                rank=rank,
            )
        return refs

    async def backfill_match(self, session: AsyncSession, match_id: int) -> bool:
        """Recompute the 7 MVP-derived stats for one match. Returns False if the match has no stats yet."""
        stat_rows = await self._load_stat_rows(session, match_id)
        if stat_rows.empty:
            return False

        kill_feed = await self._kill_feed_repo.list_for_match(session, match_id)
        # Recompute fight boundaries (round-aware, >15s gap) and persist them — the
        # mutated ORM rows flush on the per-match commit. MUST run before
        # build_event_counts, which derives first_picks/first_deaths from `fight`.
        # Deterministic, so it stays idempotent across reruns.
        impact.assign_fights(kill_feed)
        refs = await self._load_player_refs(session, match_id)
        hero_types = await self._load_hero_types(session)
        baselines = await baselines_service.get_active(session)
        if baselines is None:
            raise RuntimeError("Impact baselines are not computed — run recompute first")

        round_df, match_df = rebuild_frames(stat_rows)
        has_killfeed = bool(kill_feed)
        events_df = impact.build_event_counts(kill_feed, hero_types)
        round_df, match_df = _merge_events(round_df, match_df, events_df)

        round_scored = _rank_by_impact(
            impact.add_impact_scores(round_df, players=refs, baselines=baselines, has_killfeed=has_killfeed)
        )
        match_scored = _rank_by_impact(
            impact.add_impact_scores(match_df, players=refs, baselines=baselines, has_killfeed=has_killfeed)
        )

        objects = self._stat_objects(match_id, refs, round_scored, match_scored)

        # Idempotency: wipe the 7 derived stats for this match before inserting
        # the freshly computed set, so reruns replace rather than accumulate.
        await self._stats_repo.delete_for_match_by_names(session, match_id, NEW_STAT_MEMBERS)
        await self._stats_repo.create_many(session, objects)
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
            if await baselines_service.get_active(session) is None:
                raise RuntimeError("Impact baselines are not computed — run recompute first")

            query = sa.select(models.Match.id).join(models.Encounter, models.Encounter.id == models.Match.encounter_id)
            if tournament_id is not None:
                query = query.where(models.Encounter.tournament_id == tournament_id)
            match_ids = (await session.execute(query.order_by(models.Match.id))).scalars().all()

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
