"""match_win — user's team won the match.

Uses the tournament roster and native observed team scores, so a winning map
does not require any player-stat row. Official game results are not telemetry.

Grain: user_match (user_id, tournament_id, match_id).
"""

from __future__ import annotations

from typing import Any

import sqlalchemy as sa
from sqlalchemy.ext.asyncio import AsyncSession

from shared.models.achievements.achievement import AchievementGrain
from shared.repository.stats_queries import match_context, team_scores
from src import models

from ..context import EvalContext
from . import ResultSet, register


def winning_teams() -> sa.Subquery:
    """Observed winners of OW duels, keyed by the actual encounter participation."""
    scores = team_scores(discipline="overwatch", stat_code="score")
    opponent = scores.alias("opponent_score")
    duels = (
        sa.select(models.StatsMatchTeam.match_id)
        .group_by(models.StatsMatchTeam.match_id)
        .having(sa.func.count() == 2)
        .subquery()
    )
    return (
        sa.select(scores.c.match_id, scores.c.encounter_team_id, scores.c.tournament_team_id)
        .join(duels, duels.c.match_id == scores.c.match_id)
        .join(
            opponent,
            sa.and_(
                opponent.c.match_id == scores.c.match_id,
                opponent.c.encounter_team_id != scores.c.encounter_team_id,
            ),
        )
        .where(scores.c.value > opponent.c.value)
        .subquery()
    )


@register(
    "match_win",
    grain=AchievementGrain.user_match,
    description="The player's team won this map",
    depends_on=("stats.match", "stats.fact", "tournament.encounter"),
)
async def execute(
    session: AsyncSession,
    params: dict[str, Any],
    context: EvalContext,
) -> ResultSet:
    match = match_context(discipline="overwatch")
    winners = winning_teams()

    query = (
        sa.select(
            models.WorkspaceMember.player_id,
            match.c.tournament_id,
            match.c.id.label("match_id"),
        )
        .select_from(match)
        .join(winners, winners.c.match_id == match.c.id)
        .join(
            models.Player,
            sa.and_(
                models.Player.team_id == winners.c.tournament_team_id,
                models.Player.tournament_id == match.c.tournament_id,
            ),
        )
        .join(
            models.WorkspaceMember,
            sa.and_(
                models.WorkspaceMember.id == models.Player.workspace_member_id,
                models.WorkspaceMember.workspace_id == match.c.workspace_id,
            ),
        )
        .where(
            match.c.workspace_id == context.workspace_id,
            models.Player.is_substitution.is_(False),
        )
    )

    if context.tournament:
        query = query.where(match.c.tournament_id == context.tournament.id)

    result = await session.execute(query)
    return {(row[0], row[1], row[2]) for row in result}
