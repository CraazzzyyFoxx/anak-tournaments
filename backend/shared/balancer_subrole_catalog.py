"""Resolve the per-workspace sub-role catalog for registration forms.

Kept as a one-line facade so existing callers do not move. The query lives on
``PlayerSubRoleService.catalog_for_workspace``.
"""

from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncSession

from shared.services.player_sub_role import SubroleCatalog, player_sub_role_service

__all__ = ("SubroleCatalog", "resolve_subrole_catalog")


async def resolve_subrole_catalog(
    session: AsyncSession,
    workspace_id: int,
) -> SubroleCatalog:
    """Return ``{reg_role_code: [{"slug", "label"}]}`` for active sub-roles."""
    return await player_sub_role_service.catalog_for_workspace(session, workspace_id)
