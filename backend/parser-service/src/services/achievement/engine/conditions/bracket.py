"""bracket_path — checks a team's path through the tournament bracket.

Grain: user_tournament.
"""

from __future__ import annotations

from typing import Any

import sqlalchemy as sa
from sqlalchemy.ext.asyncio import AsyncSession

from src import models

from ..context import EvalContext
from . import ResultSet, register


@register("bracket_path")
async def execute_bracket_path(
    session: AsyncSession,
    params: dict[str, Any],
    context: EvalContext,
) -> ResultSet:
    """Check team's bracket path in tournament. Grain: user_tournament.

    params:
        played_lower_bracket: bool (default true) — team played at least one lower bracket match
        played_upper_bracket: bool (optional) — team played at least one upper bracket match
        min_lower_bracket_wins: int (optional) — minimum wins in lower bracket
        lost_in_round: dict (optional) — {op, value} for the round where team first lost
            e.g. {"op": "==", "value": 1} — lost in round 1 specifically
    """
    played_lower = params.get("played_lower_bracket", True)
    played_upper = params.get("played_upper_bracket")
    min_lb_wins = params.get("min_lower_bracket_wins")
    lost_in_round = params.get("lost_in_round")

    from .stat_threshold import OPERATORS

    # Find teams that played in lower bracket (round < 0) encounters
    # In Challonge double elimination: round > 0 = upper, round < 0 = lower
    base_where = [
        models.Encounter.status == "COMPLETED",
        models.Tournament.workspace_id == context.workspace_id,
        models.TournamentGroup.is_groups.is_(False),
    ]

    if context.tournament:
        base_where.append(models.Encounter.tournament_id == context.tournament.id)

    if played_lower:
        # Teams that have at least one encounter with round < 0
        lower_teams = (
            sa.select(
                models.Encounter.tournament_id,
                sa.case(
                    (
                        models.Encounter.home_score > models.Encounter.away_score,
                        models.Encounter.home_team_id,
                    ),
                    else_=models.Encounter.away_team_id,
                ).label("team_id"),
            )
            .join(models.Tournament, models.Tournament.id == models.Encounter.tournament_id)
            .join(
                models.TournamentGroup,
                models.TournamentGroup.id == models.Encounter.tournament_group_id,
            )
            .where(
                *base_where,
                models.Encounter.round < 0,
            )
        )

        if min_lb_wins:
            # Count lower bracket wins
            lower_teams = (
                lower_teams
                .group_by(
                    models.Encounter.tournament_id,
                    sa.text("team_id"),
                )
                .having(sa.func.count() >= min_lb_wins)
            )

        # Also include teams that LOST in upper bracket (they go to lower)
        # A team in lower bracket = team that lost at least one upper bracket match
        lost_upper = (
            sa.select(
                models.Encounter.tournament_id,
                sa.case(
                    (
                        models.Encounter.home_score < models.Encounter.away_score,
                        models.Encounter.home_team_id,
                    ),
                    else_=models.Encounter.away_team_id,
                ).label("team_id"),
            )
            .join(models.Tournament, models.Tournament.id == models.Encounter.tournament_id)
            .join(
                models.TournamentGroup,
                models.TournamentGroup.id == models.Encounter.tournament_group_id,
            )
            .where(
                *base_where,
                models.Encounter.round > 0,
                models.Encounter.home_score != models.Encounter.away_score,
            )
        )

        if lost_in_round:
            op_fn = OPERATORS[lost_in_round["op"]]
            lost_upper = lost_upper.where(op_fn(models.Encounter.round, lost_in_round["value"]))

        # Union: teams in lower bracket OR teams that lost in upper
        lb_teams_sq = sa.union_all(lower_teams, lost_upper).subquery("lb_teams")

        # Get players on those teams
        query = (
            sa.select(models.Player.user_id, models.Player.tournament_id)
            .join(
                lb_teams_sq,
                sa.and_(
                    models.Player.team_id == lb_teams_sq.c.team_id,
                    models.Player.tournament_id == lb_teams_sq.c.tournament_id,
                ),
            )
            .where(models.Player.is_substitution.is_(False))
        )

    elif played_upper is True:
        # Only upper bracket: teams with encounters where round > 0 and never round < 0
        upper_teams = (
            sa.select(
                models.Encounter.tournament_id,
                sa.case(
                    (
                        models.Encounter.home_score > models.Encounter.away_score,
                        models.Encounter.home_team_id,
                    ),
                    else_=models.Encounter.away_team_id,
                ).label("team_id"),
            )
            .join(models.Tournament, models.Tournament.id == models.Encounter.tournament_id)
            .join(
                models.TournamentGroup,
                models.TournamentGroup.id == models.Encounter.tournament_group_id,
            )
            .where(
                *base_where,
                models.Encounter.round > 0,
            )
        ).subquery("upper_teams")

        query = (
            sa.select(models.Player.user_id, models.Player.tournament_id)
            .join(
                upper_teams,
                sa.and_(
                    models.Player.team_id == upper_teams.c.team_id,
                    models.Player.tournament_id == upper_teams.c.tournament_id,
                ),
            )
            .where(models.Player.is_substitution.is_(False))
        )
    else:
        return set()

    result = await session.execute(query)
    return {(row[0], row[1]) for row in result}
