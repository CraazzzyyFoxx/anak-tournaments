"""
Workspace filtering utilities for SQLAlchemy queries.

Usage:
    from src.core.workspace import WorkspaceQuery, workspace_filter

    # In routes:
    async def get_all(workspace_id: WorkspaceQuery = None, ...):
        ...

    # In services — returns list of conditions to unpack into .where():
    query = query.where(*workspace_filter(workspace_id))
"""

import typing

import sqlalchemy as sa
from fastapi import Query
from shared.division_grid import DivisionGrid, load_runtime_grid
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from src import models

WorkspaceQuery = typing.Annotated[int | None, Query(alias="workspace_id")]


def workspace_filter(workspace_id: int | None) -> list:
    """
    Returns a list of WHERE conditions for workspace filtering.

    Use when Tournament is already joined/selected in the query.
    Unpack into .where(): ``query.where(*workspace_filter(workspace_id))``

    If workspace_id is None, returns an empty list (no filtering).
    """
    if workspace_id is None:
        return []
    return [models.Tournament.workspace_id == workspace_id]


async def get_division_grid(
    session: AsyncSession,
    workspace_id: int | None,
    tournament_id: int | None = None,
) -> DivisionGrid:
    version = await get_division_grid_version(session, workspace_id, tournament_id=tournament_id)
    return load_runtime_grid(version)


async def get_division_grid_version(
    session: AsyncSession,
    workspace_id: int | None,
    tournament_id: int | None = None,
) -> models.DivisionGridVersion | None:
    version_id: int | None = None

    if tournament_id is not None:
        tournament = await session.get(models.Tournament, tournament_id)
        if tournament is not None:
            version_id = tournament.division_grid_version_id
            if workspace_id is None:
                workspace_id = tournament.workspace_id

    if version_id is None and workspace_id is not None:
        workspace = await session.get(models.Workspace, workspace_id)
        if workspace is not None:
            version_id = workspace.default_division_grid_version_id

    if version_id is None:
        result = await session.execute(
            sa.select(models.DivisionGridVersion)
            .join(models.DivisionGrid, models.DivisionGrid.id == models.DivisionGridVersion.grid_id)
            .options(selectinload(models.DivisionGridVersion.tiers))
            .where(models.DivisionGrid.workspace_id.is_(None))
            .order_by(models.DivisionGridVersion.id.asc())
            .limit(1)
        )
        return result.scalar_one_or_none()

    return await session.scalar(
        sa.select(models.DivisionGridVersion)
        .options(selectinload(models.DivisionGridVersion.tiers))
        .where(models.DivisionGridVersion.id == version_id)
    )
