"""Eager-load option sets for draft rows.

``DraftPlayer`` no longer carries roles or ranks (``draftreg1`` deleted the
snapshot), so what has to be eager-loaded is its identity: the member behind
``user_id``. The registration itself is NOT loaded here -- nothing reads
``DraftPlayer.registration``, and the roster engine selects the registrations
it resolves itself, so eager-loading them alongside the seats only re-ran the
engine's own five queries and threw the rows away (2026-09-30).

Async code must eager-load these; a lazy load would raise ``MissingGreenlet``.
"""

from __future__ import annotations

from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from shared.disciplines import DISCIPLINES
from shared.models.balancer.draft import DraftPick, DraftPlayer, DraftSession, DraftTeam
from shared.models.catalog import CatalogRole
from shared.models.tournament import Tournament
from shared.repository import CatalogRoleRepository

__all__ = ("pick_options", "player_options", "rated_dimension", "rated_rows", "team_options", "tournament")


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
    discipline = await session.scalar(select(Tournament.discipline).where(Tournament.id == draft_session.tournament_id))
    return await CatalogRoleRepository().rated_rows(session, discipline=discipline, workspace_id=None)


async def tournament(session: AsyncSession, draft_session: DraftSession) -> Tournament:
    return (await session.scalars(select(Tournament).where(Tournament.id == draft_session.tournament_id))).one()


async def rated_dimension(session: AsyncSession, draft_session: DraftSession) -> str:
    owner = await tournament(session, draft_session)
    return DISCIPLINES[owner.discipline].rated_dimension.code
