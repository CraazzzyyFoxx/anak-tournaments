"""registration_timing / registration_flag — how a player entered a tournament.

Grain: user_tournament (user_id, tournament_id).
"""

from __future__ import annotations

from typing import Any

import sqlalchemy as sa
from sqlalchemy.ext.asyncio import AsyncSession

from shared import models
from shared.core.enums import TournamentStatus
from shared.core.tournament_state import as_utc
from shared.domain.achievements.context import EvalContext
from shared.models.achievements.achievement import AchievementGrain

from . import ResultSet, register
from .stat_threshold import OPERATORS

#: event -> (registration timestamp, the phase whose ``starts_at`` it is measured against)
_EVENTS: dict[str, tuple[Any, TournamentStatus]] = {
    "signup": (models.Registration.submitted_at, TournamentStatus.REGISTRATION),
    "check_in": (models.Registration.checked_in_at, TournamentStatus.CHECK_IN),
}

_FLAGS: dict[str, Any] = {
    "substitute": models.Registration.is_substitute,
    "team_manager": models.Registration.is_team_manager,
    "checked_in": models.Registration.checked_in,
}


@register(
    "registration_timing",
    grain=AchievementGrain.user_tournament,
    description="How early or late the player signed up or checked in",
    required=("event", "op", "value"),
    depends_on=("registration.registration", "tournament.player"),
)
async def execute_registration_timing(
    session: AsyncSession,
    params: dict[str, Any],
    context: EvalContext,
) -> ResultSet:
    """``value`` is minutes relative to the phase's ``starts_at``; negative is before it opened."""
    event = params["event"]
    op = params["op"]
    value = params["value"]

    stamp_column, phase = _EVENTS[event]
    op_fn = OPERATORS[op]

    query = (
        sa.select(
            models.WorkspaceMember.player_id,
            models.Registration.tournament_id,
            stamp_column,
            models.TournamentPhaseSchedule.starts_at,
        )
        .select_from(models.Registration)
        # Inner joins by design: a registration with no member has no player
        # identity, and a tournament with no schedule row for this phase has
        # nothing to measure against. Neither is a failed threshold.
        .join(
            models.WorkspaceMember,
            models.WorkspaceMember.id == models.Registration.workspace_member_id,
        )
        .join(models.Tournament, models.Tournament.id == models.Registration.tournament_id)
        .join(
            models.TournamentPhaseSchedule,
            sa.and_(
                models.TournamentPhaseSchedule.tournament_id == models.Registration.tournament_id,
                models.TournamentPhaseSchedule.status == phase,
            ),
        )
        .where(
            models.Registration.deleted_at.is_(None),
            stamp_column.is_not(None),
            sa.and_(
                models.Tournament.workspace_id == context.workspace_id,
                models.Tournament.discipline == context.discipline,
            ),
        )
    )
    if context.tournament:
        query = query.where(models.Registration.tournament_id == context.tournament.id)

    # The delta is computed in Python: no portable SQL epoch extraction spans
    # PostgreSQL and the SQLite test harness, and a tournament's registration
    # count is small enough that the rows cost nothing.
    result = await session.execute(query)
    keys: ResultSet = set()
    for user_id, tournament_id, stamp, starts_at in result:
        # SQLite hands back naive datetimes where PostgreSQL hands back aware ones.
        minutes = (as_utc(stamp) - as_utc(starts_at)).total_seconds() / 60.0
        if not op_fn(minutes, value):
            continue
        key = (user_id, tournament_id)
        keys.add(key)
        context.record_evidence(key, minutes=round(minutes, 2), event=event, op=op, threshold=value)
    return keys


@register(
    "registration_flag",
    grain=AchievementGrain.user_tournament,
    description="A property of how the player entered the tournament",
    required=("flag",),
    optional=("value",),
    depends_on=("registration.registration", "tournament.player"),
)
async def execute_registration_flag(
    session: AsyncSession,
    params: dict[str, Any],
    context: EvalContext,
) -> ResultSet:
    """Grain: user_tournament."""
    flag = params["flag"]
    value = params.get("value", True)

    query = (
        sa.select(
            models.WorkspaceMember.player_id,
            models.Registration.tournament_id,
        )
        .select_from(models.Registration)
        .join(
            models.WorkspaceMember,
            models.WorkspaceMember.id == models.Registration.workspace_member_id,
        )
        .join(models.Tournament, models.Tournament.id == models.Registration.tournament_id)
        .where(
            models.Registration.deleted_at.is_(None),
            _FLAGS[flag] == value,
            sa.and_(
                models.Tournament.workspace_id == context.workspace_id,
                models.Tournament.discipline == context.discipline,
            ),
        )
    )
    if context.tournament:
        query = query.where(models.Registration.tournament_id == context.tournament.id)

    result = await session.execute(query)
    keys: ResultSet = set()
    for user_id, tournament_id in result:
        key = (user_id, tournament_id)
        keys.add(key)
        context.record_evidence(key, flag=flag, value=value)
    return keys
