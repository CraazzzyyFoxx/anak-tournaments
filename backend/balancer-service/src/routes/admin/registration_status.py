from __future__ import annotations

from fastapi import APIRouter, Depends, status
from sqlalchemy.ext.asyncio import AsyncSession

from src import models
from src.core import auth, db
from src.schemas.admin import balancer as admin_schemas
from src.services.admin import registration_status as status_service

router = APIRouter(
    prefix="/ws/{workspace_id}/balancer-statuses",
    tags=["admin", "registration-status"],
)


def _serialize_status(
    status_row: models.BalancerRegistrationStatus,
) -> admin_schemas.BalancerRegistrationStatusRead:
    is_override = status_row.kind == "builtin" and status_row.workspace_id is not None
    return admin_schemas.BalancerRegistrationStatusRead(
        id=status_row.id,
        workspace_id=status_row.workspace_id,
        scope=status_row.scope,
        slug=status_row.slug,
        kind=status_row.kind,  # type: ignore[arg-type]
        is_override=is_override,
        can_delete=status_row.kind == "custom",
        can_reset=is_override,
        icon_slug=status_row.icon_slug,
        icon_color=status_row.icon_color,
        name=status_row.name,
        description=status_row.description,
        created_at=status_row.created_at,
        updated_at=status_row.updated_at,
    )


@router.get("/catalog", response_model=list[admin_schemas.BalancerRegistrationStatusRead])
async def list_status_catalog(
    workspace_id: int,
    session: AsyncSession = Depends(db.get_async_session),
    user: models.AuthUser = Depends(auth.require_workspace_permission("team", "read")),
):
    statuses = await status_service.list_status_catalog(session, workspace_id)
    return [_serialize_status(status_row) for status_row in statuses]


@router.get("", response_model=list[admin_schemas.BalancerRegistrationStatusRead])
async def list_custom_statuses(
    workspace_id: int,
    session: AsyncSession = Depends(db.get_async_session),
    user: models.AuthUser = Depends(auth.require_workspace_permission("team", "read")),
):
    statuses = await status_service.list_custom_statuses(session, workspace_id)
    return [_serialize_status(status_row) for status_row in statuses]


@router.post(
    "/custom",
    response_model=admin_schemas.BalancerRegistrationStatusRead,
    status_code=status.HTTP_201_CREATED,
)
async def create_custom_status(
    workspace_id: int,
    data: admin_schemas.BalancerRegistrationStatusCreate,
    session: AsyncSession = Depends(db.get_async_session),
    user: models.AuthUser = Depends(auth.require_workspace_permission("team", "update")),
):
    status_row = await status_service.create_custom_status(
        session,
        workspace_id=workspace_id,
        scope=data.scope,
        icon_slug=data.icon_slug,
        icon_color=data.icon_color,
        name=data.name,
        description=data.description,
    )
    return _serialize_status(status_row)


@router.patch("/custom/{status_id}", response_model=admin_schemas.BalancerRegistrationStatusRead)
async def update_custom_status(
    workspace_id: int,
    status_id: int,
    data: admin_schemas.BalancerRegistrationStatusUpdate,
    session: AsyncSession = Depends(db.get_async_session),
    user: models.AuthUser = Depends(auth.require_workspace_permission("team", "update")),
):
    status_row = await status_service.update_custom_status(
        session,
        workspace_id=workspace_id,
        status_id=status_id,
        icon_slug=data.icon_slug,
        icon_color=data.icon_color,
        name=data.name,
        description=data.description,
    )
    return _serialize_status(status_row)


@router.delete("/custom/{status_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_custom_status(
    workspace_id: int,
    status_id: int,
    session: AsyncSession = Depends(db.get_async_session),
    user: models.AuthUser = Depends(auth.require_workspace_permission("team", "update")),
):
    await status_service.delete_custom_status(
        session,
        workspace_id=workspace_id,
        status_id=status_id,
    )


@router.put("/system/{scope}/{slug}", response_model=admin_schemas.BalancerRegistrationStatusRead)
async def upsert_builtin_override(
    workspace_id: int,
    scope: admin_schemas.StatusScope,
    slug: str,
    data: admin_schemas.BalancerRegistrationStatusUpdate,
    session: AsyncSession = Depends(db.get_async_session),
    user: models.AuthUser = Depends(auth.require_workspace_permission("team", "update")),
):
    status_row = await status_service.upsert_builtin_override(
        session,
        workspace_id=workspace_id,
        scope=scope,
        slug=slug,
        icon_slug=data.icon_slug,
        icon_color=data.icon_color,
        name=data.name,
        description=data.description,
    )
    return _serialize_status(status_row)


@router.delete("/system/{scope}/{slug}", status_code=status.HTTP_204_NO_CONTENT)
async def reset_builtin_override(
    workspace_id: int,
    scope: admin_schemas.StatusScope,
    slug: str,
    session: AsyncSession = Depends(db.get_async_session),
    user: models.AuthUser = Depends(auth.require_workspace_permission("team", "update")),
):
    await status_service.reset_builtin_override(
        session,
        workspace_id=workspace_id,
        scope=scope,
        slug=slug,
    )
