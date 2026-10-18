"""Native, discipline-scoped impact baselines and atomic audited recomputation.

The OW formula boundary deliberately retains current-registration rank, as in
frozen P3/D96. Observation ownership and encounter snapshots are not rewritten.
"""

from __future__ import annotations

import logging

import pandas as pd
import sqlalchemy as sa
from cashews import cache
from sqlalchemy.ext.asyncio import AsyncSession

from shared import models
from shared.core import enums
from shared.core.impact import FORMULA_VERSION, IMPACT_WEIGHTS
from shared.disciplines.overwatch import impact
from shared.disciplines.overwatch.baseline_rows import build_baseline_rows
from shared.repository.baselines import StatBaselineRepository
from shared.repository.roles import CatalogRoleRepository
from shared.repository.stats import StatDefRepository
from shared.repository.stats_queries import player_facts
from shared.services.stats_evidence import capture_stats_evidence, owner_scopes, stage_stats_evidence

__all__ = ("BaselineService", "baseline_service", "get_active", "invalidate_cache", "recompute")

logger = logging.getLogger(__name__)
_STAT_NAMES = tuple(IMPACT_WEIGHTS)
_CACHE_TTL = "10m"


class BaselineService:
    """Cached baseline read + the atomic recompute that replaces a formula version."""

    def __init__(self, *, repo: StatBaselineRepository = StatBaselineRepository()) -> None:
        self.repo = repo

    async def get_active(self, session: AsyncSession, *, discipline: str) -> impact.BaselineSet | None:
        key = f"backend:parser:impact_baselines:{discipline}:{FORMULA_VERSION}"
        if cache.is_setup():
            try:
                cached = await cache.get(key)
            except Exception:  # pragma: no cover - cache is best-effort
                logger.debug("impact baselines cache get failed", exc_info=True)
                cached = None
            if cached is not None:
                return cached

        baseline, role, dimension, stat = models.StatsBaseline, models.CatalogRole, models.RoleDimension, models.StatDef
        rows = (
            await session.execute(
                sa.select(baseline, role.code, stat.code)
                .join(role, role.id == baseline.role_id)
                .join(dimension, dimension.id == role.dimension_id)
                .join(stat, stat.id == baseline.stat_id)
                .where(
                    baseline.formula_version == FORMULA_VERSION,
                    dimension.discipline == discipline,
                    dimension.rated.is_(True),
                    stat.discipline == discipline,
                )
            )
        ).all()
        if not rows:
            return None

        bounds = tuple(rows[0][0].meta["bucket_bounds"]) if rows[0][0].meta else ()
        values = {
            (role_code.lower(), row.rank_bucket, enums.LogStatsName(stat_code).name): (row.mean, row.std)
            for row, role_code, stat_code in rows
        }
        baseline_set = impact.BaselineSet(FORMULA_VERSION, bounds, values)
        if cache.is_setup():
            try:
                await cache.set(key, baseline_set, expire=_CACHE_TTL)
            except Exception:  # pragma: no cover - cache is best-effort
                logger.debug("impact baselines cache set failed", exc_info=True)
        return baseline_set

    async def invalidate_cache(self, *, discipline: str) -> None:
        if not cache.is_setup():
            return
        try:
            await cache.delete(f"backend:parser:impact_baselines:{discipline}:{FORMULA_VERSION}")
        except Exception:  # pragma: no cover - cache is best-effort
            logger.debug("impact baselines cache invalidate failed", exc_info=True)

    async def recompute(self, session: AsyncSession, *, discipline: str) -> int:
        """Replace OW formula rows, sealing evidence before the existing commit."""
        if discipline != "overwatch":
            raise ValueError("impact baseline computation is only defined for overwatch")
        scopes = owner_scopes("baseline", (discipline, FORMULA_VERSION))
        before = await capture_stats_evidence(session, scopes=scopes)
        stats = await self._load_stats_frame(session, discipline=discipline)
        rows = build_baseline_rows(stats)
        if not rows:
            raise RuntimeError("impact baseline recompute produced 0 rows; refusing to wipe existing baselines")
        roles = await CatalogRoleRepository().rated_rows(session, discipline=discipline, workspace_id=None)
        stat_ids = await StatDefRepository().ids(session, discipline=discipline)
        baseline_rows = [
            models.StatsBaseline(
                formula_version=FORMULA_VERSION,
                role_id=roles[row["role"]].id,
                rank_bucket=row["rank_bucket"],
                stat_id=stat_ids[enums.LogStatsName[row["stat"]].value],
                mean=row["mean"],
                std=row["std"],
                meta=row["meta"],
            )
            for row in rows
        ]
        await self.repo.replace_for_version(session, FORMULA_VERSION, baseline_rows, discipline=discipline)
        after = await capture_stats_evidence(session, scopes=scopes)
        if before != after:
            await stage_stats_evidence(
                session,
                operation="stats.baseline_recompute",
                before=before,
                after=after,
                workspace_id=None,
                entity_type="stats_baseline",
                entity_id=None,
            )
        await session.commit()
        await self.invalidate_cache(discipline=discipline)
        return len(rows)

    async def _load_stats_frame(self, session: AsyncSession, *, discipline: str) -> pd.DataFrame:
        """Global historical OW rates, preserving total/character grains and D96 rank inputs."""
        f = player_facts(discipline=discipline).c
        totals = (
            sa.select(
                f.match_id,
                f.player_id.label("user_id"),
                f.workspace_member_id,
                f.tournament_team_id.label("team_id"),
                sa.func.max(f.value).filter(f.stat_code == enums.LogStatsName.HeroTimePlayed.value).label("seconds"),
                *[
                    sa.func.max(f.value).filter(f.stat_code == enums.LogStatsName[name].value).label(name)
                    for name in _STAT_NAMES
                ],
            )
            .where(f.segment == 0, f.entity_id.is_(None))
            .group_by(
                f.match_id,
                f.player_id,
                f.workspace_member_id,
                f.tournament_team_id,
            )
            .cte("impact_baseline_totals")
        )

        # Project JSON extraction once; grouping by this column avoids distinct
        # asyncpg bind positions for repeated attrs['class'] expressions in P3.
        character_times = (
            sa.select(
                f.match_id,
                f.player_id.label("user_id"),
                models.CatalogEntity.attrs["class"].astext.label("hero_type"),
                f.value,
            )
            .join(models.CatalogEntity, models.CatalogEntity.id == f.entity_id)
            .where(
                models.CatalogEntity.kind == "character",
                models.CatalogEntity.discipline == discipline,
                f.segment == 0,
                f.entity_id.is_not(None),
                f.stat_code == enums.LogStatsName.HeroTimePlayed.value,
            )
            .cte("impact_baseline_character_times")
        )
        hero_playtime = (
            sa.select(
                character_times.c.match_id,
                character_times.c.user_id,
                character_times.c.hero_type,
                sa.func.sum(character_times.c.value).label("seconds"),
            )
            .group_by(character_times.c.match_id, character_times.c.user_id, character_times.c.hero_type)
            .cte("impact_baseline_hero_playtime")
        )
        ranked = sa.select(
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
            sa.select(ranked.c.match_id, ranked.c.user_id, ranked.c.hero_type)
            .where(
                ranked.c.role_rank == 1,
            )
            .cte("impact_baseline_dominant_role")
        )

        roster_ranked = (
            sa.select(
                models.Player.team_id,
                models.Player.workspace_member_id,
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
                models.Tournament.discipline == discipline,
            )
            .subquery("impact_baseline_roster_ranked")
        )
        roster = (
            sa.select(roster_ranked.c.team_id, roster_ranked.c.workspace_member_id, roster_ranked.c.rank)
            .where(
                roster_ranked.c.roster_rank == 1,
            )
            .cte("impact_baseline_roster")
        )
        event = models.StatsEvent
        killfeed_matches = (
            sa.select(event.match_id)
            .join(
                models.StatsMatch,
                models.StatsMatch.id == event.match_id,
            )
            .join(models.EventType, models.EventType.id == event.type_id)
            .where(
                models.StatsMatch.discipline == discipline,
                models.EventType.discipline == discipline,
                models.EventType.code == "kill",
            )
            .distinct()
            .cte("impact_baseline_killfeed_matches")
        )
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
                sa.and_(
                    dominant_role.c.match_id == totals.c.match_id,
                    dominant_role.c.user_id == totals.c.user_id,
                ),
            )
            .join(
                roster,
                sa.and_(
                    roster.c.team_id == totals.c.team_id,
                    roster.c.workspace_member_id == totals.c.workspace_member_id,
                ),
            )
            .outerjoin(killfeed_matches, killfeed_matches.c.match_id == totals.c.match_id)
            .where(
                totals.c.seconds.is_not(None),
            )
            # Float reductions must not depend on PostgreSQL's aggregate/join
            # plan. Immutable match/global-player keys define the input order.
            .order_by(totals.c.match_id, totals.c.user_id)
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
        df = df[df["minutes"] > 0].copy()
        ten_minute_units = df["minutes"] / 10.0
        for name in _STAT_NAMES:
            value = df.pop(name).fillna(0.0).astype(float)
            df[f"{name}_rate"] = value / ten_minute_units
        return df


baseline_service = BaselineService()
get_active = baseline_service.get_active
invalidate_cache = baseline_service.invalidate_cache
recompute = baseline_service.recompute
