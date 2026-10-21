"""Eager-load option sets for draft rows, and the owning tournament's reads.

Roles and ranks come from the roster engine, so what a seat eager-loads is its
identity: the member behind ``user_id``. The registration is NOT loaded here:
the roster engine selects the registrations it resolves itself.

Async code must eager-load these; a lazy load would raise ``MissingGreenlet``.
"""

from __future__ import annotations

from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from shared.disciplines import DISCIPLINES
from shared.models.catalog import CatalogRole
from shared.models.draft import DraftPick, DraftPlayer, DraftSession, DraftTeam
from shared.models.tournament import Tournament
from shared.repository import CatalogRoleRepository
from shared.repository.tournament import TournamentRepository

__all__ = ("pick_options", "player_options", "rated_dimension", "rated_rows", "team_options", "tournament")

_tournaments = TournamentRepository()


def player_options() -> list[Any]:
    """The member behind ``user_id``. Roles and ranks come from the roster engine."""
    return [selectinload(DraftPlayer.member)]


def team_options() -> list[Any]:
    """``DraftTeam.captain_user_id`` reads ``captain_member``."""
    return [selectinload(DraftTeam.captain_member)]


def pick_options() -> list[Any]:
    """``DraftPick.picked_by_user_id`` reads ``picked_by_member``."""
    return [selectinload(DraftPick.picked_by_member)]


async def rated_rows(session: AsyncSession, draft_session: DraftSession) -> dict[str, CatalogRole]:
    owner = await tournament(session, draft_session)
    return await CatalogRoleRepository().rated_rows(session, discipline=owner.discipline, workspace_id=None)


async def tournament(session: AsyncSession, draft_session: DraftSession) -> Tournament:
    owner = await _tournaments.get(session, draft_session.tournament_id)
    if owner is None:  # unreachable while draft_session.tournament_id is a live FK
        raise LookupError(f"Tournament {draft_session.tournament_id} of draft {draft_session.id} not found")
    return owner


async def rated_dimension(session: AsyncSession, draft_session: DraftSession) -> str:
    owner = await tournament(session, draft_session)
    return DISCIPLINES[owner.discipline].rated_dimension.code
