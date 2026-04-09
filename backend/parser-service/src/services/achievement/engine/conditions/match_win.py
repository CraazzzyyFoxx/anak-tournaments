"""match_win — user's team won the match.

Grain: user_match (user_id, tournament_id, match_id).
"""

from __future__ import annotations

from typing import Any

import sqlalchemy as sa
from sqlalchemy.ext.asyncio import AsyncSession

from src import models

from ..context import EvalContext
from . import ResultSet, register


@register("match_win")
async def execute(
    session: AsyncSession,
    params: dict[str, Any],
    context: EvalContext,
) -> ResultSet:
    query = (
        sa.select(
            models.MatchStatistics.user_id,
            models.Encounter.tournament_id,
            models.MatchStatistics.match_id,
        )
        .join(models.Match, models.Match.id == models.MatchStatistics.match_id)
        .join(models.Encounter, models.Encounter.id == models.Match.encounter_id)
        .join(models.Tournament, models.Tournament.id == models.Encounter.tournament_id)
        .join(models.Team, models.Team.id == models.MatchStatistics.team_id)
        .where(
            models.MatchStatistics.round == 0,
            models.MatchStatistics.hero_id.is_(None),
            models.MatchStatistics.name == "Eliminations",  # just need one stat row per user
            models.Tournament.workspace_id == context.workspace_id,
            sa.or_(
                sa.and_(
                    models.Encounter.home_team_id == models.Team.id,
                    models.Encounter.home_score > models.Encounter.away_score,
                ),
                sa.and_(
                    models.Encounter.away_team_id == models.Team.id,
                    models.Encounter.away_score > models.Encounter.home_score,
                ),
            ),
        )
        .group_by(
            models.MatchStatistics.user_id,
            models.Encounter.tournament_id,
            models.MatchStatistics.match_id,
        )
    )

    if context.tournament:
        query = query.where(models.Encounter.tournament_id == context.tournament.id)

    result = await session.execute(query)
    return {(row[0], row[1], row[2]) for row in result}
