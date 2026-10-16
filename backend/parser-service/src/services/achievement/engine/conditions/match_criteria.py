"""match_criteria — match/encounter property meets a threshold.

For encounter-level fields (closeness): awards all players in matching encounters.
For match-level fields (match_time, time): awards all players in matching matches.

Grain: user_match (user_id, tournament_id, match_id).
"""

from __future__ import annotations

from typing import Any

import sqlalchemy as sa
from sqlalchemy.ext.asyncio import AsyncSession

from shared.models.achievements.achievement import AchievementGrain
from shared.repository.stats_queries import match_context
from src import models
from src.domain.achievement_duel import active_seat

from ..context import EvalContext
from . import ResultSet, register
from .stat_threshold import OPERATORS

# Existing duration DSL aliases resolve on the native header relation.
MATCH_FIELD_MAP = {"match_time": "duration_s", "time": "duration_s"}

# Fields on Encounter (per-series)
ENCOUNTER_FIELD_MAP = {
    "closeness": models.Encounter.closeness,
}


@register(
    "match_criteria",
    grain=AchievementGrain.user_match,
    description="Map or series field (closeness, match_time) compared against a value",
    required=("field", "op", "value"),
    depends_on=("stats.match", "tournament.encounter"),
)
async def execute(
    session: AsyncSession,
    params: dict[str, Any],
    context: EvalContext,
) -> ResultSet:
    field = params["field"]
    op = params["op"]
    value = params["value"]
    op_fn = OPERATORS[op]

    if field in ENCOUNTER_FIELD_MAP:
        return await _execute_encounter_field(session, field, op_fn, value, context)
    return await _execute_match_field(session, field, op_fn, value, context)


async def _execute_encounter_field(
    session: AsyncSession,
    field: str,
    op_fn,
    value,
    context: EvalContext,
) -> ResultSet:
    """Encounter-level field (e.g. closeness).

    Grain is ``user_match``, so every match of a qualifying encounter is
    projected. ``AND`` with a map-level leaf can then hit any map of the series.
    """
    column = ENCOUNTER_FIELD_MAP[field]
    seat, on_seat = active_seat()
    match = match_context(discipline="overwatch")

    query = (
        sa.select(
            models.WorkspaceMember.player_id,
            models.Encounter.tournament_id,
            match.c.id.label("match_id"),
        )
        .select_from(models.Encounter)
        .join(models.Tournament, models.Tournament.id == models.Encounter.tournament_id)
        .join(match, match.c.encounter_id == models.Encounter.id)
        .join(seat, on_seat)
        .join(
            models.Player,
            sa.and_(
                models.Player.team_id == seat.team_id,
                models.Player.tournament_id == models.Encounter.tournament_id,
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
            op_fn(column, value),
            models.Tournament.workspace_id == context.workspace_id,
            match.c.workspace_id == context.workspace_id,
            models.Player.is_substitution.is_(False),
        )
    )

    if context.tournament:
        query = query.where(models.Encounter.tournament_id == context.tournament.id)

    result = await session.execute(query)
    return {(row[0], row[1], row[2]) for row in result}


async def _execute_match_field(
    session: AsyncSession,
    field: str,
    op_fn,
    value,
    context: EvalContext,
) -> ResultSet:
    """Match-level field (e.g. match_time). One result per user per match."""
    match = match_context(discipline="overwatch")
    column = match.c[MATCH_FIELD_MAP[field]]

    query = (
        sa.select(
            models.WorkspaceMember.player_id,
            match.c.tournament_id,
            match.c.id.label("match_id"),
        )
        .select_from(match)
        .join(
            models.StatsMatchTeam,
            sa.and_(
                models.StatsMatchTeam.match_id == match.c.id,
                models.StatsMatchTeam.encounter_id == match.c.encounter_id,
            ),
        )
        .join(
            models.EncounterTeam,
            sa.and_(
                models.EncounterTeam.id == models.StatsMatchTeam.encounter_team_id,
                models.EncounterTeam.encounter_id == match.c.encounter_id,
            ),
        )
        .join(
            models.Player,
            sa.and_(
                models.Player.team_id == models.EncounterTeam.team_id,
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
            op_fn(column, value),
            match.c.workspace_id == context.workspace_id,
            models.Player.is_substitution.is_(False),
        )
    )

    if context.tournament:
        query = query.where(match.c.tournament_id == context.tournament.id)

    result = await session.execute(query)
    return {(row[0], row[1], row[2]) for row in result}
