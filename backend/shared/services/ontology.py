"""The modules' ontologies are the source of truth; ``catalog.role_dimension``/``catalog.role`` are their projection
(D31). app-service runs ``project_disciplines`` at startup."""

from __future__ import annotations

from collections.abc import Mapping, Sequence
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
from shared.schemas.role import RoleRef

__all__ = (
    "assert_discipline_enabled",
    "normalize_disciplines_enabled",
    "project_disciplines",
    "rated_leaf",
    "resolve_form_role",
    "resolve_role_ref",
)

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


def resolve_form_role(
    catalog_roles: Mapping[str, models.CatalogRole], role: str | None, sub_role: str | None
) -> models.CatalogRole | None:
    """Resolve a form's top-level code and unprefixed slug in already-scoped rated rows."""
    role = normalize_role(role)
    if not role or role == FLEX_SLOT_CODE:
        return None
    top = catalog_roles.get(role)
    if top is None or top.parent_role_id is not None or top.workspace_id is not None:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=f"unknown_role: {role!r}")
    code = workspace_sub_role_code(top.code, sub_role)
    if code is None:
        return top
    leaf = catalog_roles.get(code)
    if leaf is None or leaf.parent_role_id != top.id:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"unknown_sub_role: {sub_role!r} is not a sub-role of {role!r} in this workspace",
        )
    return leaf


async def rated_leaf(
    session: AsyncSession, *, discipline: str, workspace_id: int, role: str | None, sub_role: str | None
) -> models.CatalogRole | None:
    """Resolve a legacy/form ``(role, sub_role)`` pair on the owner's rated dimension.

    The form keeps the unprefixed slug; the ontology stores its parent-qualified code.
    No role or ``flex`` means no assignment. Unknown pairs never fall back to a parent.
    """
    if normalize_role(role) in (None, FLEX_SLOT_CODE):
        return None
    rows = await _roles.rated_rows(session, discipline=discipline, workspace_id=workspace_id)
    return resolve_form_role(rows, role, sub_role)


async def resolve_role_ref(
    session: AsyncSession, *, discipline: str, workspace_id: int, ref: RoleRef | None, top_level_only: bool = False
) -> models.CatalogRole | None:
    """Resolve the submitted leaf on the owner's rated dimension; parent is output-only."""
    if ref is None:
        return None
    rated = DISCIPLINES[discipline].rated_dimension.code
    if ref.dimension != rated:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"role_dimension_mismatch: {ref.dimension!r} is not {discipline}'s {rated!r}",
        )
    try:
        row = await _roles.resolve(
            session,
            discipline=discipline,
            workspace_id=None if top_level_only else workspace_id,
            dimension=rated,
            code=ref.role,
        )
    except UnknownRole as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=f"unknown_role: {exc}") from None
    if top_level_only and row.parent_role_id is not None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=f"unknown_role: {ref.role!r} is a sub-role"
        )
    return row
