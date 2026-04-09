"""standing_position / standing_record — tournament standings conditions.

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


@register("standing_position")
async def execute_position(
    session: AsyncSession,
    params: dict[str, Any],
    context: EvalContext,
) -> ResultSet:
    op = params["op"]
    value = params["value"]
    op_fn = OPERATORS[op]

    query = (
        sa.select(
            models.Player.user_id,
            models.Standing.tournament_id,
        )
        .select_from(models.Standing)
        .join(models.Tournament, models.Tournament.id == models.Standing.tournament_id)
        .join(models.Player, models.Player.team_id == models.Standing.team_id)
        .where(
            op_fn(models.Standing.overall_position, value),
            models.Tournament.workspace_id == context.workspace_id,
            models.Player.is_substitution.is_(False),
        )
    )

    if context.tournament:
        query = query.where(models.Standing.tournament_id == context.tournament.id)

    result = await session.execute(query)
    return {(row[0], row[1]) for row in result}


@register("standing_record")
async def execute_record(
    session: AsyncSession,
    params: dict[str, Any],
    context: EvalContext,
) -> ResultSet:
    """Check standing record fields: wins, losses, draws, points, buchholz."""
    field = params["field"]
    op = params["op"]
    value = params["value"]

    column_map = {
        "wins": models.Standing.win,
        "losses": models.Standing.lose,
        "draws": models.Standing.draw,
        "points": models.Standing.points,
        "buchholz": models.Standing.buchholz,
        "matches": models.Standing.matches,
    }
    column = column_map[field]
    op_fn = OPERATORS[op]

    query = (
        sa.select(
            models.Player.user_id,
            models.Standing.tournament_id,
        )
        .select_from(models.Standing)
        .join(models.Tournament, models.Tournament.id == models.Standing.tournament_id)
        .join(models.Player, models.Player.team_id == models.Standing.team_id)
        .where(
            op_fn(column, value),
            models.Tournament.workspace_id == context.workspace_id,
            models.Player.is_substitution.is_(False),
        )
    )

    if context.tournament:
        query = query.where(models.Standing.tournament_id == context.tournament.id)

    result = await session.execute(query)
    return {(row[0], row[1]) for row in result}
