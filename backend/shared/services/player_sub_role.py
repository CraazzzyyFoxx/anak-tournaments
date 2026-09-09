"""Workspace player-sub-role catalog.

Write path is the admin CRUD; the public registration catalog is the same rows
grouped by registration role code. Both go through ``PlayerSubRoleRepository``
so the filter/order cannot drift.
"""

from __future__ import annotations

from typing import Any, Protocol

from sqlalchemy.ext.asyncio import AsyncSession

from shared import models
from shared.core import http_status as status
from shared.core.errors import BaseAPIException as HTTPException
from shared.domain.player_sub_roles import build_subrole_catalog, normalize_role, normalize_sub_role
from shared.rbac.workspace_lookup import get_player_sub_role_workspace_id
from shared.repository import PlayerSubRoleRepository
from shared.rpc.crud import EntityConfig
from shared.schemas.player_sub_role import PlayerSubRoleCreate, PlayerSubRoleRead, PlayerSubRoleUpdate

__all__ = (
    "PlayerSubRoleService",
    "SubroleCatalog",
    "player_sub_role_entity",
    "player_sub_role_service",
)

SubroleCatalog = dict[str, list[dict[str, str]]]


class _CreateData(Protocol):
    workspace_id: int
    role: str
    label: str
    slug: str | None
    description: str | None
    sort_order: int
    is_active: bool


class _UpdateData(Protocol):
    def model_dump(self, *, exclude_unset: bool = False) -> dict[str, Any]: ...


def _normalize_role_or_raise(role: str | None) -> str:
    normalized = normalize_role(role)
    if normalized is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Role is required.")
    return normalized


def _normalize_slug_or_raise(slug: str | None, label: str | None) -> str:
    normalized = normalize_sub_role(slug or label)
    if normalized is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Sub-role slug or label is required.",
        )
    return normalized


class PlayerSubRoleService:
    def __init__(
        self,
        *,
        sub_role_repo: PlayerSubRoleRepository = PlayerSubRoleRepository(),
    ) -> None:
        self.sub_role_repo = sub_role_repo

    async def list_sub_roles(
        self,
        session: AsyncSession,
        *,
        workspace_id: int,
        role: str | None = None,
        include_inactive: bool = False,
    ) -> list[models.PlayerSubRole]:
        return list(
            await self.sub_role_repo.list_for_workspace(
                session,
                workspace_id,
                role=None if role is None else _normalize_role_or_raise(role),
                only_active=not include_inactive,
            )
        )

    async def catalog_for_workspace(self, session: AsyncSession, workspace_id: int) -> SubroleCatalog:
        rows = await self.sub_role_repo.list_for_workspace(session, workspace_id, only_active=True)
        return build_subrole_catalog(rows)

    async def get_sub_role(self, session: AsyncSession, sub_role_id: int) -> models.PlayerSubRole:
        sub_role = await self.sub_role_repo.get(session, sub_role_id)
        if sub_role is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Player sub-role not found.",
            )
        return sub_role

    async def create_sub_role(self, session: AsyncSession, data: _CreateData) -> models.PlayerSubRole:
        role = _normalize_role_or_raise(data.role)
        slug = _normalize_slug_or_raise(data.slug, data.label)

        existing = await self.sub_role_repo.get_by_slug(session, workspace_id=data.workspace_id, role=role, slug=slug)
        if existing is not None:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Player sub-role already exists for this workspace and role.",
            )

        sub_role = await self.sub_role_repo.create(
            session,
            models.PlayerSubRole(
                workspace_id=data.workspace_id,
                role=role,
                slug=slug,
                label=data.label.strip(),
                description=data.description,
                sort_order=data.sort_order,
                is_active=data.is_active,
            ),
        )
        await session.commit()
        await session.refresh(sub_role)
        return sub_role

    async def update_sub_role(
        self,
        session: AsyncSession,
        sub_role_id: int,
        data: _UpdateData,
    ) -> models.PlayerSubRole:
        sub_role = await self.get_sub_role(session, sub_role_id)
        update_data = data.model_dump(exclude_unset=True)

        if "role" in update_data:
            update_data["role"] = _normalize_role_or_raise(update_data["role"])
        if "slug" in update_data:
            update_data["slug"] = _normalize_slug_or_raise(
                update_data["slug"],
                update_data.get("label", sub_role.label),
            )
        if "label" in update_data and update_data["label"] is not None:
            update_data["label"] = update_data["label"].strip()

        next_role = update_data.get("role", sub_role.role)
        next_slug = update_data.get("slug", sub_role.slug)
        if next_role != sub_role.role or next_slug != sub_role.slug:
            existing = await self.sub_role_repo.get_by_slug(
                session, workspace_id=sub_role.workspace_id, role=next_role, slug=next_slug
            )
            if existing is not None:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail="Player sub-role already exists for this workspace and role.",
                )

        for field, value in update_data.items():
            setattr(sub_role, field, value)

        await session.commit()
        await session.refresh(sub_role)
        return sub_role

    async def deactivate_sub_role(self, session: AsyncSession, sub_role_id: int) -> None:
        sub_role = await self.get_sub_role(session, sub_role_id)
        sub_role.is_active = False
        await session.commit()


player_sub_role_service = PlayerSubRoleService()


def _first(value: Any) -> Any:
    if isinstance(value, list):
        return value[0] if value else None
    return value


def _int_or_400(value: Any, field: str) -> int:
    value = _first(value)
    if value is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"missing {field}")
    try:
        return int(value)
    except (TypeError, ValueError) as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"invalid {field}") from exc


def _dump(row: models.PlayerSubRole) -> dict[str, Any]:
    return PlayerSubRoleRead.model_validate(row, from_attributes=True).model_dump(mode="json")


async def _serialize(_session: AsyncSession, row: models.PlayerSubRole) -> dict[str, Any]:
    return _dump(row)


async def _ws_from_payload(_session: AsyncSession, data: dict[str, Any]) -> int:
    return _int_or_400((data.get("payload") or {}).get("workspace_id"), "workspace_id")


async def _ws_from_query(_session: AsyncSession, data: dict[str, Any]) -> int:
    return _int_or_400((data.get("query") or {}).get("workspace_id"), "workspace_id")


async def _list_rpc(session: AsyncSession, data: dict[str, Any]) -> list[dict[str, Any]]:
    query = data.get("query") or {}
    include = _first(query.get("include_inactive"))
    include_inactive = str(include).lower() in ("1", "true", "yes", "on") if include is not None else False
    rows = await player_sub_role_service.list_sub_roles(
        session,
        workspace_id=_int_or_400(query.get("workspace_id"), "workspace_id"),
        role=_first(query.get("role")) or None,
        include_inactive=include_inactive,
    )
    return [_dump(row) for row in rows]


def player_sub_role_entity() -> EntityConfig:
    """CRUD entity any service's ``CrudDispatcher`` can register as-is."""
    return EntityConfig(
        entity="player_sub_role",
        model=None,
        permission_resource="player",
        serializer=_serialize,
        create_schema=PlayerSubRoleCreate,
        update_schema=PlayerSubRoleUpdate,
        resolve_ws_from_id=get_player_sub_role_workspace_id,
        resolve_ws_for_create=_ws_from_payload,
        resolve_ws_for_list=_ws_from_query,
        service_create=lambda session, payload, _data: player_sub_role_service.create_sub_role(session, payload),
        service_update=lambda session, row_id, payload, _data: player_sub_role_service.update_sub_role(
            session, row_id, payload
        ),
        service_delete=lambda session, row_id, _data: player_sub_role_service.deactivate_sub_role(session, row_id),
        list_fn=_list_rpc,
        not_found_detail="Player sub-role not found",
        actions=frozenset({"create", "update", "delete", "list"}),
    )
