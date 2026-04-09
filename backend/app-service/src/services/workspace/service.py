import typing

import sqlalchemy as sa
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import joinedload

from src import models


async def get_by_id(session: AsyncSession, workspace_id: int) -> models.Workspace | None:
    result = await session.execute(
        sa.select(models.Workspace).where(models.Workspace.id == workspace_id)
    )
    return result.scalars().first()


async def get_by_slug(session: AsyncSession, slug: str) -> models.Workspace | None:
    result = await session.execute(
        sa.select(models.Workspace).where(models.Workspace.slug == slug)
    )
    return result.scalars().first()


async def get_all(session: AsyncSession) -> typing.Sequence[models.Workspace]:
    result = await session.execute(
        sa.select(models.Workspace).order_by(models.Workspace.id)
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


async def create(session: AsyncSession, **kwargs) -> models.Workspace:
    workspace = models.Workspace(**kwargs)
    session.add(workspace)
    await session.flush()
    return workspace


async def update(
    session: AsyncSession, workspace: models.Workspace, data: dict
) -> models.Workspace:
    for field, value in data.items():
        setattr(workspace, field, value)
    await session.flush()
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
