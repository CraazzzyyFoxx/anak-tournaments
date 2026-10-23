"""The name somebody goes by inside a tournament.

Participant lists, rosters and the draft board already show the in-game handle
a player registered with (the primary identity of the tournament discipline's provider).
This is the same rule for surfaces that start from an auth account instead of a
registration (room chat), so a captain is not "the Discord handle they signed up
with" there and "their game handle" everywhere else.
"""

from __future__ import annotations

import sqlalchemy as sa
from sqlalchemy.ext.asyncio import AsyncSession

from shared import models
from shared.disciplines import identity_provider

__all__ = ("tournament_display_name",)


async def tournament_display_name(session: AsyncSession, *, auth_user: models.AuthUser, tournament_id: int) -> str:
    """Registered tag for this tournament, else the account's game handle, else
    the site name (staff need not play). Two round trips."""
    discipline = await session.scalar(
        sa.select(models.Tournament.discipline).where(models.Tournament.id == tournament_id)
    )
    provider = identity_provider(discipline)
    registered = (
        sa.select(models.RegistrationIdentity.handle)
        .join(
            models.Registration,
            models.Registration.id == models.RegistrationIdentity.registration_id,
        )
        .join(models.WorkspaceMember, models.WorkspaceMember.id == models.Registration.workspace_member_id)
        .join(models.User, models.User.id == models.WorkspaceMember.player_id)
        .where(
            models.Registration.tournament_id == tournament_id,
            models.Registration.deleted_at.is_(None),
            models.RegistrationIdentity.provider == provider,
            models.RegistrationIdentity.position == 0,
            models.User.auth_user_id == auth_user.id,
        )
        .limit(1)
        .scalar_subquery()
    )
    game_handle = (
        sa.select(models.SocialAccount.username)
        .join(models.User, models.User.id == models.SocialAccount.user_id)
        .where(
            models.User.auth_user_id == auth_user.id,
            models.SocialAccount.provider == provider,
        )
        .order_by(models.SocialAccount.is_primary.desc(), models.SocialAccount.id.asc())
        .limit(1)
        .scalar_subquery()
    )
    name = await session.scalar(sa.select(sa.func.coalesce(registered, game_handle)))
    return name or auth_user.username
