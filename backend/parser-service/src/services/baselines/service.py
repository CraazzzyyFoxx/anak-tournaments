"""Impact-scoring baselines: cached read + atomic recompute (spec 2026-07-10).

Baselines are versioned by ``FORMULA_VERSION`` and replaced atomically by
:meth:`BaselineService.recompute`. Reads are cashews-cached (10m TTL) behind a
single literal key so ``get_active`` avoids re-scanning ``matches.stat_baselines``
on every scoring call.

``recompute`` is IO — loading the stats frame from the DB and atomically
replacing the version's rows — and is exercised at rollout (see Task 10
runbook), not by unit tests, since it needs a live database. The pure
aggregation it delegates to, ``build_baseline_rows``, lives in
``src.domain.baselines`` and is unit-tested there.
"""

from __future__ import annotations

import logging

import pandas as pd
import sqlalchemy as sa
from cashews import cache
from sqlalchemy.ext.asyncio import AsyncSession

from shared.core.impact import FORMULA_VERSION, IMPACT_WEIGHTS
from shared.repository.baselines import StatBaselineRepository
from src import models
from src.core import enums
from src.domain.baselines import build_baseline_rows
from src.domain.match_logs import impact

__all__ = ("BaselineService", "baseline_service", "get_active", "invalidate_cache", "recompute")

logger = logging.getLogger(__name__)

_STAT_NAMES = tuple(IMPACT_WEIGHTS)

# Full literal key (NOT a cashews key template — FORMULA_VERSION is a module
# constant, not a subscriber argument cashews could substitute). Must start
# with a prefix this process actually registers via ``configure_cache()``
# (parser-service only registers ``backend:``, see src/core/caching.py) or
# every get/set/delete raises NotConfiguredError (see
# lesson_cashews_prefixless_delete_match).
_CACHE_KEY = f"backend:parser:impact_baselines:{FORMULA_VERSION}"
_CACHE_TTL = "10m"


class BaselineService:
    """Cached baseline read + the atomic recompute that replaces a formula version."""

    def __init__(self, *, repo: StatBaselineRepository = StatBaselineRepository()) -> None:
        self.repo = repo

    async def get_active(self, session: AsyncSession) -> impact.BaselineSet | None:
        """Return the active :class:`impact.BaselineSet`, cashews-cached for 10m."""
        if cache.is_setup():
            try:
                cached = await cache.get(_CACHE_KEY)
            except Exception:  # pragma: no cover - cache is best-effort
                logger.debug("impact baselines cache get failed", exc_info=True)
                cached = None
            if cached is not None:
                return cached

        rows = (
            (
                await session.execute(
                    sa.select(models.StatBaseline).where(models.StatBaseline.formula_version == FORMULA_VERSION)
                )
            )
            .scalars()
            .all()
        )
        if not rows:
            return None

        bounds = tuple(rows[0].meta["bucket_bounds"]) if rows[0].meta else ()
        values = {(row.role.value.lower(), row.rank_bucket, row.stat.name): (row.mean, row.std) for row in rows}
        baseline_set = impact.BaselineSet(FORMULA_VERSION, bounds, values)

        if cache.is_setup():
            try:
                await cache.set(_CACHE_KEY, baseline_set, expire=_CACHE_TTL)
            except Exception:  # pragma: no cover - cache is best-effort
                logger.debug("impact baselines cache set failed", exc_info=True)

        return baseline_set

    async def invalidate_cache(self) -> None:
        """Drop the cached active baseline set (call after :meth:`recompute` commits)."""
        if not cache.is_setup():
            return
        try:
            await cache.delete(_CACHE_KEY)
        except Exception:  # pragma: no cover - cache is best-effort
            logger.debug("impact baselines cache invalidate failed", exc_info=True)

    async def recompute(self, session: AsyncSession) -> int:
        """Recompute the active ``FORMULA_VERSION`` baselines and replace them atomically."""
        stats = await self._load_stats_frame(session)
        rows = build_baseline_rows(stats)
        if not rows:
            raise RuntimeError("impact baseline recompute produced 0 rows; refusing to wipe existing baselines")

        baseline_rows = [
            models.StatBaseline(
                formula_version=FORMULA_VERSION,
                role=enums.HeroClass(row["role"].capitalize()),
                rank_bucket=row["rank_bucket"],
                stat=enums.LogStatsName[row["stat"]],
                mean=row["mean"],
                std=row["std"],
                meta=row["meta"],
            )
            for row in rows
        ]
        await self.repo.replace_for_version(session, FORMULA_VERSION, baseline_rows)
        await session.commit()
        await self.invalidate_cache()
        return len(rows)

    async def _load_stats_frame(self, session: AsyncSession) -> pd.DataFrame:
        """Per-(match, user) rate frame for every historical stat row.

        UNTESTED here (needs a live DB) — verified at rollout, see Task 10
        runbook. Schema assumptions (flagged for rollout verification):

        * ``matches.statistics`` round-0 / hero-NULL rows are the per-match
          totals for the ``IMPACT_WEIGHTS`` stats + ``HeroTimePlayed``.
        * "Dominant role" per (match, user) = the ``overwatch.hero.type`` with
          the most summed round-0 per-hero ``HeroTimePlayed`` seconds (mirrors
          ``impact.dominant_roles`` — NOT ``tournament.player.role``, so it
          matches what Task 5 scores against). Ties are broken arbitrarily by
          ``row_number()`` (same non-determinism ``dominant_roles`` already has).
        * ``rank`` comes from the ``tournament.player`` row for that exact
          ``(team_id, user_id)`` pair (``user_id`` = ``workspace_member.player_id``,
          the auth-identity id also used as ``matches.statistics.user_id`` and
          ``matches.kill_feed.killer_id/victim_id``). If more than one ``Player``
          row exists for the same team+identity (e.g. a substitution edge case),
          the non-substitute / most-recent row wins — unverified against
          production data.
        * ``has_killfeed`` = the match has >=1 ``matches.kill_feed`` row.
        """
        stat_columns = [
            sa.func.max(models.MatchStatistics.value)
            .filter(models.MatchStatistics.name == enums.LogStatsName[name])
            .label(name)
            for name in _STAT_NAMES
        ]
        totals = (
            sa.select(
                models.MatchStatistics.match_id.label("match_id"),
                models.MatchStatistics.user_id.label("user_id"),
                models.MatchStatistics.team_id.label("team_id"),
                sa.func.max(models.MatchStatistics.value)
                .filter(models.MatchStatistics.name == enums.LogStatsName.HeroTimePlayed)
                .label("seconds"),
                *stat_columns,
            )
            .where(models.MatchStatistics.round == 0, models.MatchStatistics.hero_id.is_(None))
            .group_by(models.MatchStatistics.match_id, models.MatchStatistics.user_id, models.MatchStatistics.team_id)
            .cte("impact_baseline_totals")
        )

        hero_playtime = (
            sa.select(
                models.MatchStatistics.match_id.label("match_id"),
                models.MatchStatistics.user_id.label("user_id"),
                models.Hero.type.label("hero_type"),
                sa.func.sum(models.MatchStatistics.value).label("seconds"),
            )
            .select_from(models.MatchStatistics)
            .join(models.Hero, models.Hero.id == models.MatchStatistics.hero_id)
            .where(
                models.MatchStatistics.round == 0,
                models.MatchStatistics.hero_id.is_not(None),
                models.MatchStatistics.name == enums.LogStatsName.HeroTimePlayed,
            )
            .group_by(models.MatchStatistics.match_id, models.MatchStatistics.user_id, models.Hero.type)
            .cte("impact_baseline_hero_playtime")
        )
        hero_playtime_ranked = sa.select(
            hero_playtime.c.match_id,
            hero_playtime.c.user_id,
            hero_playtime.c.hero_type,
            sa.func.row_number()
            .over(
                partition_by=(hero_playtime.c.match_id, hero_playtime.c.user_id),
                order_by=hero_playtime.c.seconds.desc(),
            )
            .label("role_rank"),
        ).subquery("impact_baseline_hero_playtime_ranked")
        dominant_role = (
            sa.select(
                hero_playtime_ranked.c.match_id,
                hero_playtime_ranked.c.user_id,
                hero_playtime_ranked.c.hero_type,
            )
            .where(hero_playtime_ranked.c.role_rank == 1)
            .cte("impact_baseline_dominant_role")
        )

        roster_ranked = (
            sa.select(
                models.Player.team_id.label("team_id"),
                models.WorkspaceMember.player_id.label("user_id"),
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
            .subquery("impact_baseline_roster_ranked")
        )
        roster = (
            sa.select(roster_ranked.c.team_id, roster_ranked.c.user_id, roster_ranked.c.rank)
            .where(roster_ranked.c.roster_rank == 1)
            .cte("impact_baseline_roster")
        )

        killfeed_matches = sa.select(models.MatchKillFeed.match_id).distinct().cte("impact_baseline_killfeed_matches")

        query = (
            sa.select(
                dominant_role.c.hero_type,
                roster.c.rank,
                totals.c.seconds,
                killfeed_matches.c.match_id.is_not(None).label("has_killfeed"),
                *[totals.c[name] for name in _STAT_NAMES],
            )
            .select_from(totals)
            .join(
                dominant_role,
                sa.and_(dominant_role.c.match_id == totals.c.match_id, dominant_role.c.user_id == totals.c.user_id),
            )
            .join(roster, sa.and_(roster.c.team_id == totals.c.team_id, roster.c.user_id == totals.c.user_id))
            .outerjoin(killfeed_matches, killfeed_matches.c.match_id == totals.c.match_id)
            .where(totals.c.seconds.is_not(None))
        )

        result = await session.execute(query)
        df = pd.DataFrame(result.mappings().all())
        if df.empty:
            return pd.DataFrame(
                columns=["role", "rank", "minutes", "has_killfeed", *(f"{s}_rate" for s in _STAT_NAMES)]
            )

        df["minutes"] = df.pop("seconds").astype(float) / 60.0
        df["role"] = df.pop("hero_type").map(lambda t: str(getattr(t, "value", t)).lower())
        df["has_killfeed"] = df["has_killfeed"].fillna(False).astype(bool)
        df["rank"] = df["rank"].astype(int)

        # Exclude non-positive-minute rows before computing rates: dividing by
        # zero minutes yields inf/nan and raises a RuntimeWarning on every real
        # recompute() run. Safe — build_baseline_rows already drops everything
        # below BASELINE_MIN_MINUTES (> 0), so no currently-kept row is lost.
        df = df[df["minutes"] > 0].copy()

        # rate unit MUST match impact.py: rate = value / seconds * 600 (per-10-min).
        # seconds/600 == minutes/10, so value / (minutes/10) is the same rate.
        ten_minute_units = df["minutes"] / 10.0
        for name in _STAT_NAMES:
            value = df.pop(name).fillna(0.0).astype(float)
            df[f"{name}_rate"] = value / ten_minute_units

        return df


baseline_service = BaselineService()
get_active = baseline_service.get_active
invalidate_cache = baseline_service.invalidate_cache
recompute = baseline_service.recompute
