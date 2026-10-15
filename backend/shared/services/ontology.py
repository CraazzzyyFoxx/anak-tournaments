"""The modules' ontologies are the source of truth; ``catalog.role_dimension``/``catalog.role`` are their projection
(D31). app-service runs ``project_disciplines`` at startup."""

from __future__ import annotations

from collections.abc import Sequence
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from shared import models
from shared.core import http_status as status
from shared.core.errors import BaseAPIException as HTTPException
from shared.disciplines import DISCIPLINES
from shared.domain.player_sub_roles import normalize_role, workspace_sub_role_code
from shared.domain.roles import UnknownRole
from shared.domain.roster_shape import FLEX_SLOT_CODE
from shared.repository import CatalogRoleRepository

__all__ = ("assert_discipline_enabled", "normalize_disciplines_enabled", "project_disciplines", "rated_leaf")

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


async def rated_leaf(
    session: AsyncSession, *, discipline: str, workspace_id: int, role: str | None, sub_role: str | None
) -> models.CatalogRole | None:
    """Resolve a legacy/form ``(role, sub_role)`` pair on the owner's rated dimension.

    The form keeps the unprefixed slug; the ontology stores its parent-qualified code.
    No role or ``flex`` means no assignment. Unknown pairs never fall back to a parent.
    """
    role = normalize_role(role)
    if not role or role == FLEX_SLOT_CODE:
        return None
    try:
        top = await _roles.resolve(session, discipline=discipline, workspace_id=None, dimension=None, code=role)
    except UnknownRole as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=f"unknown_role: {exc}") from None
    code = workspace_sub_role_code(top.code, sub_role)
    if code is None:
        return top
    try:
        leaf = await _roles.resolve(
            session, discipline=discipline, workspace_id=workspace_id, dimension=None, code=code
        )
    except UnknownRole:
        leaf = None
    if leaf is None or leaf.workspace_id != workspace_id or leaf.parent_role_id != top.id:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"unknown_sub_role: {sub_role!r} is not a sub-role of {role!r} in this workspace",
        )
    return leaf
