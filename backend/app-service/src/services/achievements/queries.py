"""Achievement service v2 based on rules + effective achievement rows."""

from __future__ import annotations

import typing
from dataclasses import dataclass
from datetime import datetime

import sqlalchemy as sa
from cashews import cache
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm.strategy_options import _AbstractLoad

from shared.models.achievements.achievement import AchievementRule
from shared.repository.stats_reads import MatchReadContext, get_match_reads
from shared.services.achievement_effective import build_effective_achievement_rows_subquery
from src import models
from src.core import config, pagination, utils

__all__ = ("AchievementQueries", "UserAchievementRow", "queries")

# Cache-key prefix for the per-workspace rarity aggregate. Invalidated broadly on
# a ``tournament.standings`` invalidation (see ``services.cache_resources``) — earned
# achievements and the player denominator both move with tournament/match data.
# The map is ``{rule_id: rarity}`` over every discipline: each rule's rarity already
# divides by its own discipline's players, so one entry per workspace is not game-mixed.
_RARITY_MAP_CACHE_KEY = "backend:achievement_rarity_map:{workspace_id}"


@dataclass(slots=True)
class UserAchievementRow:
    rule: AchievementRule
    tournament_id: int | None
    match_id: int | None
    qualified_at: datetime
    rarity: float | None


def _players_by_discipline(workspace_id: int | None) -> sa.Subquery:
    """Distinct players who took part in a tournament of each discipline (optionally of one workspace).

    A rule's rarity divides by *its own* game's population: Overwatch earners are never
    divided by League-only players.
    """
    query = (
        sa.select(
            models.Tournament.discipline.label("discipline"),
            sa.func.count(models.WorkspaceMember.player_id.distinct()).label("players"),
        )
        .select_from(models.Player)
        .join(models.Tournament, models.Tournament.id == models.Player.tournament_id)
        .join(models.WorkspaceMember, models.WorkspaceMember.id == models.Player.workspace_member_id)
        .group_by(models.Tournament.discipline)
    )
    if workspace_id:
        query = query.where(models.Tournament.workspace_id == workspace_id)
    return query.subquery("players_by_discipline")


def _effective_rows_subq(
    *,
    workspace_id: int | None = None,
    rule_ids: list[int] | None = None,
    user_ids: list[int] | None = None,
    name: str = "effective_achievement_rows",
) -> sa.Subquery:
    return build_effective_achievement_rows_subquery(
        workspace_id=workspace_id,
        achievement_rule_ids=rule_ids,
        user_ids=user_ids,
        name=name,
    )


def get_rarity_subq(
    workspace_id: int | None = None,
    rule_id: int | None = None,
    *,
    merge_slugs: bool = False,
) -> sa.Subquery:
    """Rarity = distinct users earned / players of the rule's discipline (optionally per workspace).

    ``merge_slugs`` is the cross-workspace view: every workspace carries its own
    copy of a rule under the same slug, so the earners of all enabled copies *of the
    same discipline* are pooled and each copy reports the (discipline, slug) rarity.
    """
    players = _players_by_discipline(workspace_id)
    effective_rows = _effective_rows_subq(
        workspace_id=workspace_id,
        rule_ids=[rule_id] if rule_id is not None else None,
        name="rarity_effective_rows",
    )
    rarity = (sa.func.count(sa.distinct(effective_rows.c.user_id)) / sa.func.nullif(players.c.players, 0)).label(
        "rarity"
    )
    earned = (
        sa.select(AchievementRule.discipline, AchievementRule.slug, effective_rows.c.achievement_rule_id, rarity)
        .select_from(effective_rows)
        .join(AchievementRule, AchievementRule.id == effective_rows.c.achievement_rule_id)
        .join(players, players.c.discipline == AchievementRule.discipline)
    )

    if not merge_slugs:
        return earned.group_by(
            AchievementRule.discipline, AchievementRule.slug, effective_rows.c.achievement_rule_id, players.c.players
        ).subquery()

    by_slug = (
        sa.select(AchievementRule.discipline, AchievementRule.slug, rarity)
        .select_from(effective_rows)
        .join(AchievementRule, AchievementRule.id == effective_rows.c.achievement_rule_id)
        .join(players, players.c.discipline == AchievementRule.discipline)
        .where(AchievementRule.enabled.is_(True))
        .group_by(AchievementRule.discipline, AchievementRule.slug, players.c.players)
        .subquery("rarity_by_slug")
    )
    return (
        sa.select(AchievementRule.id.label("achievement_rule_id"), by_slug.c.rarity)
        .select_from(AchievementRule)
        .join(
            by_slug,
            sa.and_(by_slug.c.discipline == AchievementRule.discipline, by_slug.c.slug == AchievementRule.slug),
        )
        .subquery()
    )


def _slug_representatives() -> sa.Select:
    """One enabled rule per (discipline, slug) (the oldest) — the cross-workspace catalogue entry."""
    return (
        sa.select(sa.func.min(AchievementRule.id))
        .where(AchievementRule.enabled.is_(True))
        .group_by(AchievementRule.discipline, AchievementRule.slug)
    )


def rule_entity(in_entities: list[str], child: typing.Any | None = None) -> list[_AbstractLoad]:
    """Loading options for AchievementRule relationships."""
    entities = []
    if "entity" in in_entities:
        entities.append(utils.join_entity(child, AchievementRule.entity))
    return entities


class AchievementQueries:
    """Achievement-rule reads: rarity aggregates, per-user effective rows, and the
    tournament/match hydration the flows need to render links.

    The two bulk hydration reads used to live in a separate
    ``achievements/_repositories.py``; they are plain ``IN (...)`` selects over
    tournament-flow tables that only this domain reads, so they sit here rather
    than becoming a shared CRUD repository.
    """

    async def get(
        self,
        session: AsyncSession,
        id: int,
        entities: list[str],
        workspace_id: int | None = None,
        *,
        merge_slugs: bool = False,
    ) -> tuple[AchievementRule, float] | None:
        """Retrieve a single achievement rule by ID with rarity.

        ``merge_slugs`` reports the slug's pooled rarity, as the cross-workspace
        catalogue does for the same rule.
        """
        rarity_subq = (
            get_rarity_subq(merge_slugs=True) if merge_slugs else get_rarity_subq(workspace_id=workspace_id, rule_id=id)
        )

        query = (
            sa.select(AchievementRule, rarity_subq.c.rarity)
            .options(*rule_entity(entities))
            .outerjoin(
                rarity_subq,
                AchievementRule.id == rarity_subq.c.achievement_rule_id,
            )
            .where(
                AchievementRule.id == id,
                AchievementRule.enabled.is_(True),
            )
        )

        if workspace_id is not None:
            query = query.where(AchievementRule.workspace_id == workspace_id)

        result = await session.execute(query)
        return result.first()

    async def get_all(
        self,
        session: AsyncSession,
        params: pagination.PaginationSortParams,
        workspace_id: int | None = None,
    ) -> tuple[typing.Sequence[tuple[AchievementRule, float]], int]:
        """Paginated list of achievement rules with rarity.

        Without a workspace (the cross-workspace view) rules are deduplicated by
        (discipline, slug): one representative per key, carrying the pooled rarity.
        """
        merge_slugs = not workspace_id
        filters = [AchievementRule.enabled.is_(True)]
        if workspace_id:
            filters.append(AchievementRule.workspace_id == workspace_id)

        count_query = sa.select(sa.func.count(AchievementRule.id)).where(*filters)
        if merge_slugs:
            count_query = count_query.where(AchievementRule.id.in_(_slug_representatives()))

        rarity_subq = get_rarity_subq(workspace_id=workspace_id, merge_slugs=merge_slugs)
        query = (
            sa.select(AchievementRule, rarity_subq.c.rarity.label("rarity"))
            .options(*rule_entity(params.entities))
            .outerjoin(
                rarity_subq,
                AchievementRule.id == rarity_subq.c.achievement_rule_id,
            )
            .where(*filters)
        )
        if merge_slugs:
            query = query.where(AchievementRule.id.in_(_slug_representatives()))

        query = params.apply_pagination_sort(query)
        count = await session.execute(count_query)
        results = await session.execute(query)
        return results.all(), count.scalar()

    @cache(ttl=config.settings.achievements_cache_ttl, key=_RARITY_MAP_CACHE_KEY)
    async def _get_rarity_map(
        self,
        session: AsyncSession,
        *,
        workspace_id: int | None = None,
    ) -> dict[int, float]:
        """Rarity per achievement rule for a workspace: ``{rule_id: rarity}``.

        This is the expensive, profile-independent aggregate (UNION ALL + correlated
        EXISTS + GROUP BY over the *whole* workspace history, plus the player-count
        denominator). It does not depend on whose profile is being viewed, so it is
        cached per ``workspace_id`` (TTL ``achievements_cache_ttl``) instead of being
        recomputed on every "Achievements" tab open. Invalidated on
        a ``tournament.standings`` invalidation (services.cache_resources).
        """
        rarity_subq = get_rarity_subq(workspace_id=workspace_id, merge_slugs=workspace_id is None)
        result = await session.execute(sa.select(rarity_subq.c.achievement_rule_id, rarity_subq.c.rarity))
        return {rule_id: float(rarity) for rule_id, rarity in result.all() if rarity is not None}

    async def get_all_rules_with_rarity(
        self,
        session: AsyncSession,
        workspace_id: int | None = None,
    ) -> typing.Sequence[tuple[AchievementRule, float | None]]:
        """All enabled rules with rarity, unpaginated — used to derive locked achievements.

        Rarity comes from the cached per-workspace map (``_get_rarity_map``); only the
        cheap enabled-rules lookup runs per call.
        """
        rarity_map = await self._get_rarity_map(session, workspace_id=workspace_id)

        query = sa.select(AchievementRule).where(AchievementRule.enabled.is_(True)).order_by(AchievementRule.id)
        if workspace_id:
            query = query.where(AchievementRule.workspace_id == workspace_id)

        rules = (await session.execute(query)).scalars().all()
        return [(rule, rarity_map.get(rule.id)) for rule in rules]

    async def get_count_users(
        self,
        session: AsyncSession,
        rule_ids: list[int],
    ) -> dict[int, int]:
        """Count distinct users per achievement rule."""
        if not rule_ids:
            return {}

        effective_rows = _effective_rows_subq(
            rule_ids=rule_ids,
            name="count_effective_rows",
        )
        query = sa.select(
            effective_rows.c.achievement_rule_id,
            sa.func.count(sa.distinct(effective_rows.c.user_id)).label("count"),
        ).group_by(effective_rows.c.achievement_rule_id)
        results = await session.execute(query)
        return {row[0]: row[1] for row in results.all()}

    async def get_count_users_by_slug(
        self,
        session: AsyncSession,
        keys: list[tuple[str, str]],
    ) -> dict[tuple[str, str], int]:
        """Count distinct users per ``(discipline, slug)``, pooled over every workspace's enabled copy."""
        if not keys:
            return {}

        rule_ids = list(
            (
                await session.execute(
                    sa.select(AchievementRule.id).where(
                        sa.tuple_(AchievementRule.discipline, AchievementRule.slug).in_(keys),
                        AchievementRule.enabled.is_(True),
                    )
                )
            ).scalars()
        )
        if not rule_ids:
            return {}

        effective_rows = _effective_rows_subq(rule_ids=rule_ids, name="slug_count_effective_rows")
        query = (
            sa.select(
                AchievementRule.discipline,
                AchievementRule.slug,
                sa.func.count(sa.distinct(effective_rows.c.user_id)),
            )
            .select_from(effective_rows)
            .join(AchievementRule, AchievementRule.id == effective_rows.c.achievement_rule_id)
            .group_by(AchievementRule.discipline, AchievementRule.slug)
        )
        results = await session.execute(query)
        return {(discipline, slug): count for discipline, slug, count in results.all()}

    async def get_users_for_rule(
        self,
        session: AsyncSession,
        rule_id: int,
        params: pagination.PaginationParams,
        *,
        merge_slugs: bool = False,
    ) -> tuple[list[tuple[models.User, int, int | None, int | None]], int]:
        """Paginated list of users who earned a specific achievement.

        ``merge_slugs`` pools the earners of every enabled copy of the rule's (discipline, slug).
        """
        rule_ids = [rule_id]
        if merge_slugs:
            own = sa.orm.aliased(AchievementRule)
            copies = (
                sa.select(AchievementRule.id)
                .join(
                    own,
                    sa.and_(
                        own.id == rule_id,
                        own.slug == AchievementRule.slug,
                        own.discipline == AchievementRule.discipline,
                    ),
                )
                .where(AchievementRule.enabled.is_(True))
            )
            # Never empty: an empty id list would read as "no rule filter".
            rule_ids = list((await session.execute(copies)).scalars()) or rule_ids
        effective_rows = _effective_rows_subq(rule_ids=rule_ids, name="rule_users_effective_rows")

        total_query = sa.select(sa.func.count(sa.distinct(effective_rows.c.user_id)))

        query = (
            sa.select(
                models.User,
                sa.func.count().label("total"),
                sa.func.max(effective_rows.c.tournament_id).label("last_tournament_id"),
                sa.func.max(effective_rows.c.match_id).label("last_match_id"),
            )
            .select_from(effective_rows)
            .join(models.User, models.User.id == effective_rows.c.user_id)
            .group_by(models.User.id)
            .order_by(sa.desc(sa.text("total")))
        )
        query = params.apply_pagination(query)

        results = await session.execute(query)
        total = await session.scalar(total_query)
        return [(r[0], r[1], r[2], r[3]) for r in results], total or 0

    async def get_user_results(
        self,
        session: AsyncSession,
        user: models.User,
        workspace_id: int | None = None,
        tournament_id: int | None = None,
        without_tournament: bool = False,
    ) -> list[UserAchievementRow]:
        """Retrieve all effective achievement results for a user, with rarity."""
        effective_rows = _effective_rows_subq(
            workspace_id=workspace_id,
            user_ids=[user.id],
            name="user_effective_rows",
        )
        rarity_subq = get_rarity_subq(workspace_id=workspace_id, merge_slugs=workspace_id is None)

        query = (
            sa.select(
                AchievementRule,
                effective_rows.c.tournament_id,
                effective_rows.c.match_id,
                effective_rows.c.qualified_at,
                rarity_subq.c.rarity,
            )
            .select_from(effective_rows)
            .join(AchievementRule, AchievementRule.id == effective_rows.c.achievement_rule_id)
            .outerjoin(
                rarity_subq,
                AchievementRule.id == rarity_subq.c.achievement_rule_id,
            )
            .where(AchievementRule.enabled.is_(True))
            .order_by(sa.asc(rarity_subq.c.rarity), AchievementRule.id.asc())
        )

        if tournament_id is not None:
            query = query.where(effective_rows.c.tournament_id == tournament_id)

        if without_tournament:
            query = query.where(effective_rows.c.tournament_id.is_(None))

        results = await session.execute(query)
        return [
            UserAchievementRow(
                rule=row[0],
                tournament_id=row[1],
                match_id=row[2],
                qualified_at=row[3],
                rarity=row[4],
            )
            for row in results.all()
        ]

    async def get_tournaments_bulk(
        self,
        session: AsyncSession,
        tournament_ids: typing.Sequence[int],
    ) -> typing.Sequence[models.Tournament]:
        if not tournament_ids:
            return []
        query = sa.select(models.Tournament).where(models.Tournament.id.in_(tournament_ids))
        result = await session.execute(query)
        return list(result.unique().scalars().all())

    async def get_matches_bulk(
        self,
        session: AsyncSession,
        match_ids: typing.Sequence[int],
    ) -> typing.Sequence[MatchReadContext]:
        return list((await get_match_reads(session, match_ids=match_ids)).values())


queries = AchievementQueries()
