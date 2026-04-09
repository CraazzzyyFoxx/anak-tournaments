"""
Workspace filtering utilities for SQLAlchemy queries.

Provides a declarative way to apply workspace_id filtering to any query,
automatically resolving the join path from the source model to Tournament.workspace_id.

Usage in routes:
    from src.core.workspace import WorkspaceQuery

    async def get_all(workspace_id: WorkspaceQuery = None, ...):
        ...

Usage in services:
    from src.core.workspace import workspace_filter

    # Returns list of conditions to unpack into .where()
    query = query.where(*workspace_filter(workspace_id))

    # For queries that don't already join Tournament — use apply_workspace_filter
    query = apply_workspace_filter(query, workspace_id, root=models.Encounter)
"""

import typing

import sqlalchemy as sa
from fastapi import Query
from sqlalchemy.ext.asyncio import AsyncSession

from shared.division_grid import DEFAULT_GRID, DivisionGrid, resolve_grid

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


# Join paths from model → Tournament.
# Each entry is a list of (source_model, target_model, join_condition) tuples
# that need to be applied in order to reach Tournament.
_JOIN_PATHS: dict[type, list[tuple]] = {
    models.Tournament: [],
    models.TournamentGroup: [
        (models.Tournament, models.TournamentGroup.tournament_id == models.Tournament.id),
    ],
    models.Team: [
        (models.Tournament, models.Team.tournament_id == models.Tournament.id),
    ],
    models.Player: [
        (models.Tournament, models.Player.tournament_id == models.Tournament.id),
    ],
    models.Encounter: [
        (models.Tournament, models.Encounter.tournament_id == models.Tournament.id),
    ],
    models.Standing: [
        (models.Tournament, models.Standing.tournament_id == models.Tournament.id),
    ],
    models.Match: [
        (models.Encounter, models.Match.encounter_id == models.Encounter.id),
        (models.Tournament, models.Encounter.tournament_id == models.Tournament.id),
    ],
    models.MatchStatistics: [
        (models.Match, models.MatchStatistics.match_id == models.Match.id),
        (models.Encounter, models.Match.encounter_id == models.Encounter.id),
        (models.Tournament, models.Encounter.tournament_id == models.Tournament.id),
    ],
}


def apply_workspace_filter(
    query: sa.Select,
    workspace_id: int | None,
    *,
    root: type | None = None,
) -> sa.Select:
    """
    Applies workspace filtering to a query, adding necessary JOINs.

    Args:
        query: The SQLAlchemy Select query.
        workspace_id: The workspace ID to filter by. None means no filtering.
        root: The primary model being queried. Used to determine the join path
              to Tournament.workspace_id. If None or Tournament is already in
              the query's FROM clause, only the WHERE condition is added.

    Returns:
        The query with workspace filtering applied.
    """
    if workspace_id is None:
        return query

    if root is not None and root in _JOIN_PATHS:
        for target_model, condition in _JOIN_PATHS[root]:
            query = query.join(target_model, condition, isouter=False)

    return query.where(models.Tournament.workspace_id == workspace_id)


async def get_division_grid(
    session: AsyncSession,
    workspace_id: int | None,
    tournament_id: int | None = None,
) -> DivisionGrid:
    workspace_grid_json = None
    tournament_grid_json = None

    if workspace_id is not None:
        workspace = await session.get(models.Workspace, workspace_id)
        if workspace:
            workspace_grid_json = workspace.division_grid_json

    if tournament_id is not None:
        tournament = await session.get(models.Tournament, tournament_id)
        if tournament:
            tournament_grid_json = tournament.division_grid_json
            if workspace_id is None and workspace_grid_json is None:
                workspace = await session.get(models.Workspace, tournament.workspace_id)
                if workspace:
                    workspace_grid_json = workspace.division_grid_json

    return resolve_grid(workspace_grid_json, tournament_grid_json)
