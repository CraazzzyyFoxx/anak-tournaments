"""The modules' ontologies are the source of truth; ``catalog.role_dimension``/``catalog.role`` are their projection
(D31). app-service runs ``project_disciplines`` at startup."""

from __future__ import annotations

from collections.abc import Sequence
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from shared.core import http_status as status
from shared.core.errors import BaseAPIException as HTTPException
from shared.disciplines import DISCIPLINES
from shared.repository import CatalogRoleRepository

__all__ = ("assert_discipline_enabled", "normalize_disciplines_enabled", "project_disciplines")

_roles = CatalogRoleRepository()


async def project_disciplines(session: AsyncSession) -> None:
    """Every registered module into ``catalog.*``; the caller commits."""
    for spec in DISCIPLINES.values():
        await _roles.project_module(session, spec)


def assert_discipline_enabled(workspace: Any, discipline: str) -> None:
    """D89: creation is limited to the disciplines enabled for the workspace."""
    if discipline not in DISCIPLINES or discipline not in workspace.disciplines_enabled:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"discipline_not_enabled: {discipline!r} is not enabled for this workspace",
        )


def normalize_disciplines_enabled(codes: Sequence[str]) -> list[str]:
    """Known codes, each once, in the given order; at least one (D89)."""
    if not codes or any(code not in DISCIPLINES for code in codes):
        raise ValueError(f"disciplines_enabled must list known disciplines, got {list(codes)!r}")
    return list(dict.fromkeys(codes))
