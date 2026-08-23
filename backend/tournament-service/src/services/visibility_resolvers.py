"""Resolve the owning ``tournament_id`` for entity-level reads so the shared
hidden-tournament guard can gate them. Lightweight scalar queries mirroring the
workspace resolvers in ``src/core/auth.py``; each raises 404 when the entity is
absent (indistinguishable from a hidden tournament to outsiders).
"""

from __future__ import annotations

import sqlalchemy as sa
from sqlalchemy.ext.asyncio import AsyncSession

from shared.core import http_status as status
from shared.core.errors import BaseAPIException as HTTPException
from src import models


class VisibilityResolverService:
    """Scalar ``tournament_id`` lookups.

    Deliberately not repository ``get()`` calls: each resolver reads exactly one
    column, so loading the whole ORM row (and populating the identity map with it)
    would cost more than the guard it feeds.
    """

    async def _scalar_or_404(self, session: AsyncSession, stmt: sa.Select, detail: str) -> int:
        val = await session.scalar(stmt)
        if val is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=detail)
        return int(val)

    async def tournament_id_for_encounter(self, session: AsyncSession, encounter_id: int) -> int:
        return await self._scalar_or_404(
            session,
            sa.select(models.Encounter.tournament_id).where(models.Encounter.id == encounter_id),
            "Encounter not found",
        )

    async def tournament_id_for_team(self, session: AsyncSession, team_id: int) -> int:
        return await self._scalar_or_404(
            session,
            sa.select(models.Team.tournament_id).where(models.Team.id == team_id),
            "Team not found",
        )

    async def tournament_id_for_match(self, session: AsyncSession, match_id: int) -> int:
        return await self._scalar_or_404(
            session,
            sa.select(models.Encounter.tournament_id)
            .join(models.Match, models.Match.encounter_id == models.Encounter.id)
            .where(models.Match.id == match_id),
            "Match not found",
        )


visibility_resolvers_service = VisibilityResolverService()
