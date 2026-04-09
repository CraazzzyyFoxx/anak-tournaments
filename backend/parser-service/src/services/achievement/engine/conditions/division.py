"""div_change / div_level — division-related conditions.

Grain: user_tournament (user_id, tournament_id).
"""

from __future__ import annotations

from typing import Any

import sqlalchemy as sa
from sqlalchemy.ext.asyncio import AsyncSession

from src import models

from ..context import EvalContext
from . import ResultSet, register
from .stat_threshold import OPERATORS


@register("div_level")
async def execute_div_level(
    session: AsyncSession,
    params: dict[str, Any],
    context: EvalContext,
) -> ResultSet:
    """Player's division (computed from rank via grid) meets threshold."""
    op = params["op"]
    value = params["value"]

    if not context.grid:
        return set()

    op_fn = OPERATORS[op]

    query = (
        sa.select(
            models.Player.user_id,
            models.Player.tournament_id,
            models.Player.rank,
        )
        .join(models.Tournament, models.Tournament.id == models.Player.tournament_id)
        .where(
            models.Tournament.workspace_id == context.workspace_id,
            models.Player.is_substitution.is_(False),
        )
    )

    if context.tournament:
        query = query.where(models.Player.tournament_id == context.tournament.id)

    result = await session.execute(query)
    results: ResultSet = set()
    for user_id, tournament_id, rank in result:
        division = context.grid.resolve_division(rank)
        if division and op_fn(division.number, value):
            results.add((user_id, tournament_id))
    return results


@register("div_change")
async def execute_div_change(
    session: AsyncSession,
    params: dict[str, Any],
    context: EvalContext,
) -> ResultSet:
    """Division shift after tournament — requires analytics data."""
    direction = params["direction"]  # "up" or "down"
    min_shift = params["min_shift"]

    if not context.grid:
        return set()

    # Use window function LAG to compare adjacent tournament divisions
    player_with_lag = (
        sa.select(
            models.Player.user_id,
            models.Player.tournament_id,
            models.Player.rank,
            models.Player.role,
            sa.func.lag(models.Player.rank).over(
                partition_by=[models.Player.user_id, models.Player.role],
                order_by=models.Tournament.number,
            ).label("prev_rank"),
        )
        .join(models.Tournament, models.Tournament.id == models.Player.tournament_id)
        .where(
            models.Tournament.workspace_id == context.workspace_id,
            models.Player.is_substitution.is_(False),
        )
    ).subquery("player_lag")

    query = sa.select(
        player_with_lag.c.user_id,
        player_with_lag.c.tournament_id,
        player_with_lag.c.rank,
        player_with_lag.c.prev_rank,
    ).where(player_with_lag.c.prev_rank.isnot(None))

    if context.tournament:
        query = query.where(player_with_lag.c.tournament_id == context.tournament.id)

    result = await session.execute(query)
    results: ResultSet = set()
    for user_id, tournament_id, rank, prev_rank in result:
        current_div = context.grid.resolve_division(rank)
        prev_div = context.grid.resolve_division(prev_rank)
        if not current_div or not prev_div:
            continue

        shift = current_div.number - prev_div.number
        if direction == "up" and shift >= min_shift:
            results.add((user_id, tournament_id))
        elif direction == "down" and shift <= -min_shift:
            results.add((user_id, tournament_id))

    return results
