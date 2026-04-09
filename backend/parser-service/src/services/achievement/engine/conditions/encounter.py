"""encounter_score / encounter_revenge — cross-encounter conditions.

Grain: user_tournament.
"""

from __future__ import annotations

from typing import Any

import sqlalchemy as sa
from sqlalchemy.ext.asyncio import AsyncSession

from src import models

from ..context import EvalContext
from . import ResultSet, register


@register("encounter_score")
async def execute_encounter_score(
    session: AsyncSession,
    params: dict[str, Any],
    context: EvalContext,
) -> ResultSet:
    """Encounter with specific score pattern. Grain: user_tournament.

    params:
        round_type: "final" | "any" — "final" means max round in tournament
        scores: list of [home, away] pairs (e.g. [[2, 3], [3, 2]])
        winner: bool (default true) — award to winning team only
    """
    round_type = params.get("round_type", "any")
    scores = params["scores"]
    winner_only = params.get("winner", True)

    # Build score conditions
    score_conditions = []
    for home_s, away_s in scores:
        score_conditions.append(
            sa.and_(
                models.Encounter.home_score == home_s,
                models.Encounter.away_score == away_s,
            )
        )

    base_where = [
        models.Tournament.workspace_id == context.workspace_id,
        models.Encounter.status == "COMPLETED",
        sa.or_(*score_conditions),
    ]

    if context.tournament:
        base_where.append(models.Encounter.tournament_id == context.tournament.id)

    if round_type == "final":
        # Subquery: max round per tournament (non-group stage)
        max_round_sq = (
            sa.select(
                models.Encounter.tournament_id,
                sa.func.max(models.Encounter.round).label("max_round"),
            )
            .join(models.Tournament, models.Tournament.id == models.Encounter.tournament_id)
            .join(
                models.TournamentGroup,
                models.TournamentGroup.id == models.Encounter.tournament_group_id,
            )
            .where(
                models.TournamentGroup.is_groups.is_(False),
                models.Tournament.workspace_id == context.workspace_id,
            )
            .group_by(models.Encounter.tournament_id)
        ).subquery("max_round")

        query = (
            sa.select(
                models.Player.user_id,
                models.Encounter.tournament_id,
            )
            .select_from(models.Encounter)
            .join(models.Tournament, models.Tournament.id == models.Encounter.tournament_id)
            .join(max_round_sq, sa.and_(
                models.Encounter.tournament_id == max_round_sq.c.tournament_id,
                models.Encounter.round == max_round_sq.c.max_round,
            ))
        )
    else:
        query = (
            sa.select(
                models.Player.user_id,
                models.Encounter.tournament_id,
            )
            .select_from(models.Encounter)
            .join(models.Tournament, models.Tournament.id == models.Encounter.tournament_id)
        )

    if winner_only:
        # Join winning team's players
        winning_team_id = sa.case(
            (
                models.Encounter.home_score > models.Encounter.away_score,
                models.Encounter.home_team_id,
            ),
            else_=models.Encounter.away_team_id,
        )
        query = query.join(
            models.Player,
            sa.and_(
                models.Player.team_id == winning_team_id,
                models.Player.tournament_id == models.Encounter.tournament_id,
            ),
        )
    else:
        # Join all players from both teams
        query = query.join(
            models.Player,
            sa.and_(
                sa.or_(
                    models.Player.team_id == models.Encounter.home_team_id,
                    models.Player.team_id == models.Encounter.away_team_id,
                ),
                models.Player.tournament_id == models.Encounter.tournament_id,
            ),
        )

    query = query.where(
        *base_where,
        models.Player.is_substitution.is_(False),
    )

    result = await session.execute(query)
    return {(row[0], row[1]) for row in result}


@register("encounter_revenge")
async def execute_encounter_revenge(
    session: AsyncSession,
    params: dict[str, Any],
    context: EvalContext,
) -> ResultSet:
    """Team that lost to opponent earlier, then won. Grain: user_tournament.

    Finds pairs (E1, E2) where E1.id < E2.id, same teams, E1 loser = E2 winner.
    Awards to E2 winning team players.
    """
    e1 = sa.orm.aliased(models.Encounter, name="e1")
    e2 = sa.orm.aliased(models.Encounter, name="e2")

    # Same pair of teams (order-independent)
    same_teams = sa.or_(
        sa.and_(
            e1.home_team_id == e2.home_team_id,
            e1.away_team_id == e2.away_team_id,
        ),
        sa.and_(
            e1.home_team_id == e2.away_team_id,
            e1.away_team_id == e2.home_team_id,
        ),
    )

    # E1 winner's team_id
    e1_winner = sa.case(
        (e1.home_score > e1.away_score, e1.home_team_id),
        else_=e1.away_team_id,
    )
    # E2 winner's team_id
    e2_winner = sa.case(
        (e2.home_score > e2.away_score, e2.home_team_id),
        else_=e2.away_team_id,
    )
    # E1 loser = E2 winner (revenge!)
    revenge_condition = e1_winner != e2_winner

    base_where = [
        e1.tournament_id == e2.tournament_id,
        e1.id < e2.id,
        same_teams,
        revenge_condition,
        e1.status == "COMPLETED",
        e2.status == "COMPLETED",
    ]

    query = (
        sa.select(
            models.Player.user_id,
            e2.tournament_id,
        )
        .select_from(e1)
        .join(e2, sa.and_(*base_where))
        .join(models.Tournament, models.Tournament.id == e2.tournament_id)
        .join(
            models.Player,
            sa.and_(
                models.Player.team_id == e2_winner,
                models.Player.tournament_id == e2.tournament_id,
            ),
        )
        .where(
            models.Tournament.workspace_id == context.workspace_id,
            models.Player.is_substitution.is_(False),
        )
    )

    if context.tournament:
        query = query.where(e2.tournament_id == context.tournament.id)

    result = await session.execute(query)
    return {(row[0], row[1]) for row in result}
