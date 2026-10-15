"""Workspace sub-roles: catalog.role rows with a workspace_id (D31, D86).

Write path is the admin CRUD; the registration catalog is the same rows grouped by their parent's code.
"""

from __future__ import annotations

from typing import Any, Protocol

from sqlalchemy.ext.asyncio import AsyncSession

from shared import models
from shared.core import http_status as status
from shared.core.errors import BaseAPIException as HTTPException
from shared.domain.player_sub_roles import build_subrole_catalog, normalize_role, workspace_sub_role_code
from shared.domain.roles import UnknownRole
from shared.repository import CatalogRoleRepository

__all__ = ("PlayerSubRoleService", "SubroleCatalog", "player_sub_role_service")

SubroleCatalog = dict[str, list[dict[str, str]]]


class _CreateData(Protocol):
    workspace_id: int
    discipline: str
    role: str
    label: str
    slug: str | None
    description: str | None
    sort_order: int
    is_active: bool


class _UpdateData(Protocol):
    def model_dump(self, *, exclude_unset: bool = False) -> dict[str, Any]: ...


def _code_or_raise(parent: str, slug: str | None, label: str | None) -> str:
    normalized = workspace_sub_role_code(parent, slug or label)
    if normalized is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Sub-role slug or label is required.")
    if len(normalized) > 64:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Sub-role code must be at most 64 characters after normalization.",
        )
    return normalized


class PlayerSubRoleService:
    """Workspace sub-roles: ``catalog.role`` rows with ``workspace_id`` under a module role (D31, D86).

    A sub-role keeps its parent for life -- an assignment is the leaf, so moving it would rewrite every holder's
    top-level role. Its code prefixes the normalized slug with that parent, so ``main``/``flex`` can exist under
    several parents while codes remain unique per dimension and workspace (§14.3, Deviation 11).
    """

    def __init__(self, *, roles: CatalogRoleRepository = CatalogRoleRepository()) -> None:
        self.roles = roles

    async def _parent(self, session: AsyncSession, *, discipline: str, code: str | None) -> models.CatalogRole:
        try:
            parent = await self.roles.resolve(
                session, discipline=discipline, workspace_id=None, dimension=None, code=normalize_role(code) or ""
            )
        except UnknownRole:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Unknown role {code!r}.") from None
        return parent

    async def _assert_code_free(
        self, session: AsyncSession, *, parent: models.CatalogRole, workspace_id: int, code: str
    ) -> None:
        if await self.roles.code_taken(session, dimension_id=parent.dimension_id, workspace_id=None, code=code):
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"sub_role_code_reserved: {code!r} is a role of the game, not a sub-role.",
            )
        if await self.roles.code_taken(session, dimension_id=parent.dimension_id, workspace_id=workspace_id, code=code):
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT, detail="Player sub-role already exists for this workspace."
            )

    async def list_sub_roles(
        self,
        session: AsyncSession,
        *,
        workspace_id: int,
        discipline: str,
        role: str | None = None,
        include_inactive: bool = False,
    ) -> list[models.CatalogRole]:
        ontology = await self.roles.ontology(session, discipline=discipline, workspace_id=workspace_id)
        parent_id = None if role is None else (await self._parent(session, discipline=discipline, code=role)).id
        return list(
            await self.roles.list_sub_roles(
                session,
                workspace_id=workspace_id,
                dimension_id=ontology.rated.id,
                parent_id=parent_id,
                only_active=not include_inactive,
            )
        )

    async def catalog_for_workspace(
        self, session: AsyncSession, workspace_id: int, *, discipline: str
    ) -> SubroleCatalog:
        ontology = await self.roles.ontology(session, discipline=discipline, workspace_id=workspace_id)
        return build_subrole_catalog(ontology, workspace_id)

    async def get_sub_role(self, session: AsyncSession, sub_role_id: int) -> models.CatalogRole:
        sub_role = await self.roles.get(session, sub_role_id)
        if sub_role is None or sub_role.workspace_id is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Player sub-role not found.")
        return sub_role

    async def create_sub_role(self, session: AsyncSession, data: _CreateData) -> models.CatalogRole:
        parent = await self._parent(session, discipline=data.discipline, code=data.role)
        code = _code_or_raise(parent.code, data.slug, data.label)
        await self._assert_code_free(session, parent=parent, workspace_id=data.workspace_id, code=code)
        sub_role = await self.roles.create(
            session,
            models.CatalogRole(
                dimension_id=parent.dimension_id,
                workspace_id=data.workspace_id,
                parent_role_id=parent.id,
                code=code,
                name=data.label.strip(),
                description=data.description,
                sort_order=data.sort_order,
                active=data.is_active,
            ),
        )
        await session.commit()
        await session.refresh(sub_role)
        return sub_role

    async def update_sub_role(self, session: AsyncSession, sub_role_id: int, data: _UpdateData) -> models.CatalogRole:
        sub_role = await self.get_sub_role(session, sub_role_id)
        update_data = data.model_dump(exclude_unset=True)
        if "role" in update_data and normalize_role(update_data["role"]) != sub_role.parent.code:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="sub_role_parent_fixed: a sub-role keeps its role; create a new sub-role instead.",
            )
        if "slug" in update_data:
            code = _code_or_raise(sub_role.parent.code, update_data["slug"], update_data.get("label", sub_role.name))
            if code != sub_role.code:
                await self._assert_code_free(
                    session, parent=sub_role.parent, workspace_id=sub_role.workspace_id, code=code
                )
                sub_role.code = code
        if update_data.get("label") is not None:
            sub_role.name = update_data["label"].strip()
        for field, column in (("description", "description"), ("sort_order", "sort_order"), ("is_active", "active")):
            if field in update_data:
                setattr(sub_role, column, update_data[field])
        await session.commit()
        await session.refresh(sub_role)
        return sub_role

    async def deactivate_sub_role(self, session: AsyncSession, sub_role_id: int) -> None:
        sub_role = await self.get_sub_role(session, sub_role_id)
        sub_role.active = False
        await session.commit()


player_sub_role_service = PlayerSubRoleService()
