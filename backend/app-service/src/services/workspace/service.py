import typing

import sqlalchemy as sa
from shared.models.rbac import user_roles
from shared.rbac import (
    ensure_workspace_system_roles,
    legacy_workspace_role_name_for_user,
    replace_user_workspace_roles,
    user_has_only_workspace_owner_role,
)
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


async def delete(session: AsyncSession, workspace: models.Workspace) -> None:
    await session.delete(workspace)
    await session.flush()


async def get_members(
    session: AsyncSession, workspace_id: int
) -> typing.Sequence[models.WorkspaceMember]:
    result = await session.execute(
        sa.select(models.WorkspaceMember)
        .options(selectinload(models.WorkspaceMember.auth_user).selectinload(models.AuthUser.roles))
        .where(models.WorkspaceMember.workspace_id == workspace_id)
        .order_by(models.WorkspaceMember.id)
    )
    return result.scalars().all()


async def get_member(
    session: AsyncSession, workspace_id: int, auth_user_id: int
) -> models.WorkspaceMember | None:
    result = await session.execute(
        sa.select(models.WorkspaceMember)
        .options(selectinload(models.WorkspaceMember.auth_user).selectinload(models.AuthUser.roles))
        .where(
            models.WorkspaceMember.workspace_id == workspace_id,
            models.WorkspaceMember.auth_user_id == auth_user_id,
        )
    )
    return result.scalars().first()


async def add_member(
    session: AsyncSession, workspace_id: int, auth_user_id: int, role: str = "member"
) -> models.WorkspaceMember:
    await ensure_workspace_system_roles(session, workspace_id)
    member = models.WorkspaceMember(
        workspace_id=workspace_id,
        auth_user_id=auth_user_id,
        role=role,
    )
    session.add(member)
    await session.flush()
    return member


async def add_member_with_roles(
    session: AsyncSession,
    workspace_id: int,
    auth_user_id: int,
    *,
    role_ids: list[int],
    legacy_role: str = "member",
) -> models.WorkspaceMember:
    member = await add_member(session, workspace_id, auth_user_id, role=legacy_role)
    await replace_user_workspace_roles(
        session,
        user_id=auth_user_id,
        workspace_id=workspace_id,
        role_ids=role_ids,
    )
    member.role = await legacy_workspace_role_name_for_user(
        session,
        user_id=auth_user_id,
        workspace_id=workspace_id,
    )
    await session.flush()
    return member


async def update_member_role(
    session: AsyncSession, member: models.WorkspaceMember, role: str
) -> models.WorkspaceMember:
    member.role = role
    await session.flush()
    return member


async def _workspace_roles_from_ids(
    session: AsyncSession,
    workspace_id: int,
    role_ids: list[int],
) -> list[models.Role]:
    if not role_ids:
        return []
    result = await session.execute(
        sa.select(models.Role).where(
            models.Role.workspace_id == workspace_id,
            models.Role.id.in_(role_ids),
        )
    )
    roles = list(result.scalars().all())
    if len({role.id for role in roles}) != len(set(role_ids)):
        raise ValueError("All role_ids must refer to roles in the target workspace")
    return roles


async def update_member_roles(
    session: AsyncSession,
    member: models.WorkspaceMember,
    *,
    role_ids: list[int],
) -> models.WorkspaceMember:
    if await user_has_only_workspace_owner_role(
        session,
        user_id=member.auth_user_id,
        workspace_id=member.workspace_id,
    ):
        roles = await _workspace_roles_from_ids(session, member.workspace_id, role_ids)
        if all(role.name != "owner" for role in roles):
            raise ValueError("Cannot remove the last workspace owner")

    await replace_user_workspace_roles(
        session,
        user_id=member.auth_user_id,
        workspace_id=member.workspace_id,
        role_ids=role_ids,
    )
    member.role = await legacy_workspace_role_name_for_user(
        session,
        user_id=member.auth_user_id,
        workspace_id=member.workspace_id,
    )
    await session.flush()
    return member


async def get_member_workspace_roles(
    session: AsyncSession,
    workspace_id: int,
    auth_user_id: int,
) -> list[models.Role]:
    result = await session.execute(
        sa.select(models.Role)
        .join(user_roles, user_roles.c.role_id == models.Role.id)
        .where(
            user_roles.c.user_id == auth_user_id,
            models.Role.workspace_id == workspace_id,
        )
        .order_by(models.Role.is_system.desc(), models.Role.name)
    )
    return list(result.scalars().all())


async def can_remove_member(session: AsyncSession, member: models.WorkspaceMember) -> bool:
    return not await user_has_only_workspace_owner_role(
        session,
        user_id=member.auth_user_id,
        workspace_id=member.workspace_id,
    )


async def remove_member(session: AsyncSession, member: models.WorkspaceMember) -> None:
    await session.execute(
        sa.delete(user_roles).where(
            user_roles.c.user_id == member.auth_user_id,
            user_roles.c.role_id.in_(
                sa.select(models.Role.id).where(models.Role.workspace_id == member.workspace_id)
            ),
        )
    )
    await session.delete(member)
    await session.flush()
