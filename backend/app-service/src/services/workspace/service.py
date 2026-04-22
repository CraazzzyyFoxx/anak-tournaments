import typing

import sqlalchemy as sa
from shared.services import division_grid_cache
from shared.services.division_grid_access import get_default_division_grid_version_id
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from src import models


async def get_by_id(session: AsyncSession, workspace_id: int) -> models.Workspace | None:
    result = await session.execute(
        sa.select(models.Workspace)
        .options(
            selectinload(models.Workspace.default_division_grid_version)
            .selectinload(models.DivisionGridVersion.tiers)
        )
        .where(models.Workspace.id == workspace_id)
    )
    return result.scalars().first()


async def get_by_slug(session: AsyncSession, slug: str) -> models.Workspace | None:
    result = await session.execute(
        sa.select(models.Workspace)
        .options(
            selectinload(models.Workspace.default_division_grid_version)
            .selectinload(models.DivisionGridVersion.tiers)
        )
        .where(models.Workspace.slug == slug)
    )
    return result.scalars().first()


async def get_all(session: AsyncSession) -> typing.Sequence[models.Workspace]:
    result = await session.execute(
        sa.select(models.Workspace)
        .options(
            selectinload(models.Workspace.default_division_grid_version)
            .selectinload(models.DivisionGridVersion.tiers)
        )
        .order_by(models.Workspace.id)
    )
    return result.scalars().all()


async def get_user_workspaces(
    session: AsyncSession, auth_user_id: int
) -> typing.Sequence[tuple[models.Workspace, str]]:
    result = await session.execute(
        sa.select(models.Workspace, models.WorkspaceMember.role)
        .join(
            models.WorkspaceMember,
            models.WorkspaceMember.workspace_id == models.Workspace.id,
        )
        .where(models.WorkspaceMember.auth_user_id == auth_user_id)
        .order_by(models.Workspace.id)
    )
    return result.all()


async def _resolve_default_division_grid_version_id(
    session: AsyncSession,
    version_id: int | None,
) -> int:
    if version_id is not None:
        return version_id

    resolved_version_id = await get_default_division_grid_version_id(session)
    if resolved_version_id is None:
        raise RuntimeError("System default division grid version is not configured")
    return resolved_version_id


async def create(session: AsyncSession, **kwargs) -> models.Workspace:
    payload = dict(kwargs)
    payload["default_division_grid_version_id"] = await _resolve_default_division_grid_version_id(
        session,
        payload.get("default_division_grid_version_id"),
    )

    workspace = models.Workspace(**payload)
    session.add(workspace)
    await session.flush()
    return workspace


async def update(
    session: AsyncSession, workspace: models.Workspace, data: dict
) -> models.Workspace:
    resolved_data = dict(data)
    if "default_division_grid_version_id" in resolved_data:
        resolved_data["default_division_grid_version_id"] = await _resolve_default_division_grid_version_id(
            session,
            resolved_data["default_division_grid_version_id"],
        )

    should_invalidate_grid = (
        "default_division_grid_version_id" in resolved_data
        and resolved_data["default_division_grid_version_id"] != workspace.default_division_grid_version_id
    )
    for field, value in resolved_data.items():
        setattr(workspace, field, value)
    await session.flush()
    if should_invalidate_grid:
        await division_grid_cache.invalidate_workspace(workspace.id)
    return workspace


async def get_members(
    session: AsyncSession, workspace_id: int
) -> typing.Sequence[models.WorkspaceMember]:
    result = await session.execute(
        sa.select(models.WorkspaceMember).where(
            models.WorkspaceMember.workspace_id == workspace_id
        )
    )
    return result.scalars().all()


async def get_member(
    session: AsyncSession, workspace_id: int, auth_user_id: int
) -> models.WorkspaceMember | None:
    result = await session.execute(
        sa.select(models.WorkspaceMember).where(
            models.WorkspaceMember.workspace_id == workspace_id,
            models.WorkspaceMember.auth_user_id == auth_user_id,
        )
    )
    return result.scalars().first()


async def add_member(
    session: AsyncSession, workspace_id: int, auth_user_id: int, role: str = "member"
) -> models.WorkspaceMember:
    member = models.WorkspaceMember(
        workspace_id=workspace_id,
        auth_user_id=auth_user_id,
        role=role,
    )
    session.add(member)
    await session.flush()
    return member


async def update_member_role(
    session: AsyncSession, member: models.WorkspaceMember, role: str
) -> models.WorkspaceMember:
    member.role = role
    await session.flush()
    return member


async def remove_member(session: AsyncSession, member: models.WorkspaceMember) -> None:
    await session.delete(member)
    await session.flush()
