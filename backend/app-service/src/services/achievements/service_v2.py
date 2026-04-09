"""Achievement service v2 — reads from AchievementRule + AchievementEvaluationResult.

Drop-in replacement for service.py during migration. Once verified,
rename to service.py and remove the old one.
"""

import typing

import sqlalchemy as sa
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm.strategy_options import _AbstractLoad

from shared.models.achievement import (
    AchievementEvaluationResult,
    AchievementOverride,
    AchievementOverrideAction,
    AchievementRule,
)
from src import models
from src.core import pagination, utils

# Subquery to count distinct users (players) in a workspace
_player_count_subq = sa.select(sa.func.count(models.Player.user_id.distinct())).scalar_subquery()


def _player_count_for_workspace(workspace_id: int) -> sa.ScalarSelect:
    """Count distinct players within a specific workspace."""
    return (
        sa.select(sa.func.count(models.Player.user_id.distinct()))
        .join(models.Tournament, models.Tournament.id == models.Player.tournament_id)
        .where(models.Tournament.workspace_id == workspace_id)
    ).scalar_subquery()


def get_rarity_subq(
    workspace_id: int | None = None,
    rule_id: int | None = None,
) -> sa.Subquery:
    """Rarity = distinct users earned / total players (optionally per workspace)."""
    denominator = _player_count_for_workspace(workspace_id) if workspace_id else _player_count_subq

    rarity_subq = sa.select(
        AchievementEvaluationResult.achievement_rule_id,
        (
            sa.func.count(sa.distinct(AchievementEvaluationResult.user_id))
            / sa.func.nullif(denominator, 0)
        ).label("rarity"),
    ).group_by(AchievementEvaluationResult.achievement_rule_id)

    if rule_id:
        rarity_subq = rarity_subq.where(
            AchievementEvaluationResult.achievement_rule_id == rule_id
        )

    return rarity_subq.subquery()


def rule_entity(in_entities: list[str], child: typing.Any | None = None) -> list[_AbstractLoad]:
    """Loading options for AchievementRule relationships."""
    entities = []
    if "hero" in in_entities:
        entities.append(utils.join_entity(child, AchievementRule.hero))
    return entities


async def get(
    session: AsyncSession,
    id: int,
    entities: list[str],
    workspace_id: int | None = None,
) -> tuple[AchievementRule, float] | None:
    """Retrieve a single achievement rule by ID with rarity."""
    rarity_subq = get_rarity_subq(workspace_id=workspace_id, rule_id=id)

    query = (
        sa.select(AchievementRule, rarity_subq.c.rarity)
        .filter_by(id=id)
        .options(*rule_entity(entities))
        .join(
            rarity_subq,
            AchievementRule.id == rarity_subq.c.achievement_rule_id,
        )
        .where(AchievementRule.enabled.is_(True))
    )

    result = await session.execute(query)
    return result.first()


async def get_all(
    session: AsyncSession,
    params: pagination.PaginationSortParams,
    workspace_id: int | None = None,
) -> tuple[typing.Sequence[tuple[AchievementRule, float]], int]:
    """Paginated list of achievement rules with rarity."""
    count_filter = [AchievementRule.enabled.is_(True)]
    if workspace_id:
        count_filter.append(AchievementRule.workspace_id == workspace_id)

    count_query = sa.select(sa.func.count(AchievementRule.id)).where(*count_filter)

    rarity_subq = get_rarity_subq(workspace_id=workspace_id)
    query = (
        sa.select(AchievementRule, rarity_subq.c.rarity.label("rarity"))
        .options(*rule_entity(params.entities))
        .outerjoin(
            rarity_subq,
            AchievementRule.id == rarity_subq.c.achievement_rule_id,
        )
        .where(AchievementRule.enabled.is_(True))
    )
    if workspace_id:
        query = query.where(AchievementRule.workspace_id == workspace_id)

    query = params.apply_pagination_sort(query)
    count = await session.execute(count_query)
    results = await session.execute(query)
    return results.all(), count.scalar()


async def get_count_users(
    session: AsyncSession,
    rule_ids: list[int],
) -> dict[int, int]:
    """Count distinct users per achievement rule."""
    query = (
        sa.select(
            AchievementEvaluationResult.achievement_rule_id,
            sa.func.count(sa.distinct(AchievementEvaluationResult.user_id)).label("count"),
        )
        .where(AchievementEvaluationResult.achievement_rule_id.in_(rule_ids))
        .group_by(AchievementEvaluationResult.achievement_rule_id)
    )
    results = await session.execute(query)
    return {row[0]: row[1] for row in results.all()}


async def get_users_for_rule(
    session: AsyncSession,
    rule_id: int,
    params: pagination.PaginationParams,
) -> tuple[list[tuple[models.User, int, int | None, int | None]], int]:
    """Paginated list of users who earned a specific achievement."""
    total_query = sa.select(
        sa.func.count(sa.distinct(AchievementEvaluationResult.user_id))
    ).where(AchievementEvaluationResult.achievement_rule_id == rule_id)

    query = (
        sa.select(
            models.User,
            sa.func.count(AchievementEvaluationResult.id).label("total"),
            sa.func.max(AchievementEvaluationResult.tournament_id).label("last_tournament_id"),
            sa.func.max(AchievementEvaluationResult.match_id).label("last_match_id"),
        )
        .select_from(AchievementEvaluationResult)
        .join(models.User, models.User.id == AchievementEvaluationResult.user_id)
        .where(AchievementEvaluationResult.achievement_rule_id == rule_id)
        .group_by(models.User.id)
        .order_by(sa.desc(sa.text("total")))
    )
    query = params.apply_pagination(query)

    results = await session.execute(query)
    total = await session.scalar(total_query)
    return [(r[0], r[1], r[2], r[3]) for r in results], total


async def get_user_results(
    session: AsyncSession,
    user: models.User,
    workspace_id: int | None = None,
    tournament_id: int | None = None,
    without_tournament: bool = False,
) -> typing.Sequence[tuple[AchievementEvaluationResult, float]]:
    """Retrieve all achievement results for a user, with rarity.

    Combines evaluation results + grant overrides, minus revoke overrides.
    """
    rarity_subq = (
        sa.select(
            AchievementEvaluationResult.achievement_rule_id,
            (
                sa.func.count(sa.distinct(AchievementEvaluationResult.user_id))
                / sa.func.nullif(
                    _player_count_for_workspace(workspace_id) if workspace_id else _player_count_subq,
                    0,
                )
            ).label("rarity"),
        )
        .group_by(AchievementEvaluationResult.achievement_rule_id)
        .subquery()
    )

    query = (
        sa.select(AchievementEvaluationResult, rarity_subq.c.rarity)
        .options(sa.orm.joinedload(AchievementEvaluationResult.rule))
        .join(
            rarity_subq,
            AchievementEvaluationResult.achievement_rule_id == rarity_subq.c.achievement_rule_id,
        )
        .join(AchievementRule, AchievementRule.id == AchievementEvaluationResult.achievement_rule_id)
        .where(
            AchievementEvaluationResult.user_id == user.id,
            AchievementRule.enabled.is_(True),
        )
        .order_by(sa.asc(rarity_subq.c.rarity))
    )

    if workspace_id is not None:
        query = query.where(AchievementRule.workspace_id == workspace_id)

    if tournament_id is not None:
        query = query.where(AchievementEvaluationResult.tournament_id == tournament_id)

    if without_tournament:
        query = query.where(AchievementEvaluationResult.tournament_id.is_(None))

    # Exclude revoked overrides
    revoke_subq = (
        sa.select(AchievementOverride.achievement_rule_id, AchievementOverride.user_id)
        .where(
            AchievementOverride.action == AchievementOverrideAction.revoke,
            AchievementOverride.user_id == user.id,
        )
        .subquery()
    )
    query = query.outerjoin(
        revoke_subq,
        sa.and_(
            AchievementEvaluationResult.achievement_rule_id == revoke_subq.c.achievement_rule_id,
            AchievementEvaluationResult.user_id == revoke_subq.c.user_id,
        ),
    ).where(revoke_subq.c.user_id.is_(None))

    results = await session.execute(query)
    return results.all()
