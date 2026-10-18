"""hero_pickrate — played a low-pickrate hero during a tournament.

Grain: user_tournament.

Ports the legacy ``freak`` achievement: a hero counts as rare when its total
playtime in the tournament is below ``value`` (fraction) of the tournament's
total hero playtime. Pickrate is computed per tournament (cleaner than the
legacy code, which mixed global hero sums with a per-tournament total).
"""

from __future__ import annotations

from typing import Any

import sqlalchemy as sa
from sqlalchemy.ext.asyncio import AsyncSession

from shared.domain.achievements.context import EvalContext
from shared.models.achievements.achievement import AchievementGrain
from shared.repository.stats_queries import player_facts

from . import ResultSet, register
from .stat_threshold import OPERATORS

MIN_PLAYTIME_SEC = 60


@register(
    "hero_pickrate",
    grain=AchievementGrain.user_tournament,
    description="Played a hero nobody else picked",
    optional=("op", "value"),
    depends_on=("stats.fact",),
)
async def execute_hero_pickrate(
    session: AsyncSession,
    params: dict[str, Any],
    context: EvalContext,
) -> ResultSet:
    """Played a hero whose tournament pickrate is below threshold. Grain: user_tournament.

    params:
        op: comparison operator (default "<")
        value: pickrate fraction (default 0.001 == 0.1%)
    """
    op = params.get("op", "<")
    value = params.get("value", 0.001)
    op_fn = OPERATORS[op]

    facts = player_facts(discipline="overwatch")
    base_where = [
        facts.c.stat_code == "hero_time_played",
        facts.c.value > MIN_PLAYTIME_SEC,
        facts.c.entity_id.is_not(None),
        facts.c.segment == 0,
        facts.c.workspace_id == context.workspace_id,
    ]
    if context.tournament:
        base_where.append(facts.c.tournament_id == context.tournament.id)

    def _playtime_base(*columns: Any) -> sa.Select[Any]:
        return sa.select(*columns).select_from(facts).where(*base_where)

    total_sq = (
        _playtime_base(
            facts.c.tournament_id,
            sa.func.sum(facts.c.value).label("total_time"),
        ).group_by(facts.c.tournament_id)
    ).subquery("pickrate_total")

    hero_sq = (
        _playtime_base(
            facts.c.tournament_id,
            facts.c.entity_id,
            sa.func.sum(facts.c.value).label("hero_time"),
        ).group_by(facts.c.tournament_id, facts.c.entity_id)
    ).subquery("pickrate_hero")

    rare_heroes = (
        sa.select(hero_sq.c.tournament_id, hero_sq.c.entity_id)
        .join(total_sq, total_sq.c.tournament_id == hero_sq.c.tournament_id)
        .where(op_fn(hero_sq.c.hero_time, value * total_sq.c.total_time))
    ).subquery("rare_heroes")

    query = (
        _playtime_base(facts.c.player_id, facts.c.tournament_id)
        .join(
            rare_heroes,
            sa.and_(
                rare_heroes.c.tournament_id == facts.c.tournament_id,
                rare_heroes.c.entity_id == facts.c.entity_id,
            ),
        )
        .group_by(facts.c.player_id, facts.c.tournament_id)
    )

    result = await session.execute(query)
    return {(row[0], row[1]) for row in result}
