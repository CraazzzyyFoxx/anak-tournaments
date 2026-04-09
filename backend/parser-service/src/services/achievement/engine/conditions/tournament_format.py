"""tournament_format — checks the tournament bracket format.

Detects format from encounter structure:
  - double_elim: has encounters with round < 0 (lower bracket)
  - single_elim: has non-group encounters but none with round < 0
  - round_robin: only group-stage encounters (is_groups=True)

Grain: user_tournament.
"""

from __future__ import annotations

from typing import Any

import sqlalchemy as sa
from sqlalchemy.ext.asyncio import AsyncSession

from src import models

from ..context import EvalContext
from . import ResultSet, register


@register("tournament_format")
async def execute(
    session: AsyncSession,
    params: dict[str, Any],
    context: EvalContext,
) -> ResultSet:
    """Check tournament format. Grain: user_tournament.

    params:
        format: "double_elim" | "single_elim" | "round_robin" | "has_bracket"
            - double_elim: tournament has encounters with round < 0
            - single_elim: tournament has non-group encounters, all rounds > 0
            - round_robin: tournament has only group-stage encounters
            - has_bracket: tournament has any non-group encounters (double or single)
    """
    fmt = params.get("format", "double_elim")

    # Subquery: tournaments that have at least one lower bracket encounter (round < 0)
    has_lower = (
        sa.select(models.Encounter.tournament_id)
        .join(
            models.TournamentGroup,
            models.TournamentGroup.id == models.Encounter.tournament_group_id,
        )
        .where(
            models.Encounter.round < 0,
            models.TournamentGroup.is_groups.is_(False),
            models.Encounter.status == "COMPLETED",
        )
        .group_by(models.Encounter.tournament_id)
    ).subquery("has_lower")

    # Subquery: tournaments that have non-group encounters
    has_bracket = (
        sa.select(models.Encounter.tournament_id)
        .join(
            models.TournamentGroup,
            models.TournamentGroup.id == models.Encounter.tournament_group_id,
        )
        .where(
            models.TournamentGroup.is_groups.is_(False),
            models.Encounter.status == "COMPLETED",
        )
        .group_by(models.Encounter.tournament_id)
    ).subquery("has_bracket")

    if fmt == "double_elim":
        # Tournaments with lower bracket rounds
        tournament_filter = models.Tournament.id.in_(sa.select(has_lower.c.tournament_id))
    elif fmt == "single_elim":
        # Has bracket but NO lower bracket rounds
        tournament_filter = sa.and_(
            models.Tournament.id.in_(sa.select(has_bracket.c.tournament_id)),
            ~models.Tournament.id.in_(sa.select(has_lower.c.tournament_id)),
        )
    elif fmt == "round_robin":
        # Has no non-group encounters at all
        tournament_filter = ~models.Tournament.id.in_(sa.select(has_bracket.c.tournament_id))
    elif fmt == "has_bracket":
        # Any non-group encounters
        tournament_filter = models.Tournament.id.in_(sa.select(has_bracket.c.tournament_id))
    else:
        return set()

    query = (
        sa.select(models.Player.user_id, models.Player.tournament_id)
        .join(models.Tournament, models.Tournament.id == models.Player.tournament_id)
        .where(
            tournament_filter,
            models.Tournament.workspace_id == context.workspace_id,
            models.Player.is_substitution.is_(False),
        )
    )

    if context.tournament:
        query = query.where(models.Player.tournament_id == context.tournament.id)

    result = await session.execute(query)
    return {(row[0], row[1]) for row in result}
