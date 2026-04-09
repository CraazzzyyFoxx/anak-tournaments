"""match_criteria — match property (closeness, time) meets a threshold.

Awards all players in matching matches.
Grain: user_match (user_id, tournament_id, match_id).
"""

from __future__ import annotations

from typing import Any

import sqlalchemy as sa
from sqlalchemy.ext.asyncio import AsyncSession

from src import models

from ..context import EvalContext
from . import ResultSet, register
from .stat_threshold import OPERATORS


FIELD_MAP = {
    "closeness": models.Encounter.closeness,
    "match_time": models.Match.time,
    "time": models.Match.time,
}


@register("match_criteria")
async def execute(
    session: AsyncSession,
    params: dict[str, Any],
    context: EvalContext,
) -> ResultSet:
    field = params["field"]
    op = params["op"]
    value = params["value"]

    column = FIELD_MAP[field]
    op_fn = OPERATORS[op]

    query = (
        sa.select(
            models.Player.user_id,
            models.Encounter.tournament_id,
            models.Match.id.label("match_id"),
        )
        .select_from(models.Match)
        .join(models.Encounter, models.Encounter.id == models.Match.encounter_id)
        .join(models.Tournament, models.Tournament.id == models.Encounter.tournament_id)
        .join(
            models.Team,
            sa.or_(
                models.Team.id == models.Match.home_team_id,
                models.Team.id == models.Match.away_team_id,
            ),
        )
        .join(models.Player, models.Player.team_id == models.Team.id)
        .where(
            op_fn(column, value),
            models.Tournament.workspace_id == context.workspace_id,
        )
    )

    if context.tournament:
        query = query.where(models.Encounter.tournament_id == context.tournament.id)

    result = await session.execute(query)
    return {(row[0], row[1], row[2]) for row in result}
