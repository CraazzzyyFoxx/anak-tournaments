"""The modules' ontologies are the source of truth; ``catalog.role_dimension``/``catalog.role`` are their projection
(D31). app-service runs ``project_disciplines`` at startup."""

from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncSession

from shared.disciplines import DISCIPLINES
from shared.repository import CatalogRoleRepository

__all__ = ("project_disciplines",)

_roles = CatalogRoleRepository()


async def project_disciplines(session: AsyncSession) -> None:
    """Every registered module into ``catalog.*``; the caller commits."""
    for spec in DISCIPLINES.values():
        await _roles.project_module(session, spec)
