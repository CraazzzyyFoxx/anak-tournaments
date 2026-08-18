"""Workspace filtering utilities for SQLAlchemy queries.

Re-exports ``shared.services.workspace_scope`` — this was a byte-identical
copy of tournament-service's ``core/workspace.py``; the single source of
truth now lives in ``shared`` since every service's ``models.Tournament``
(etc.) is the same class object as ``shared.models.*``.

Usage (need grid/normalizer), from typed-RPC read handlers:
    from src.core.workspace import resolve_workspace_context

    ws = await resolve_workspace_context(session, workspace_id)
    return await flow(..., workspace_id=ws.id, grid=ws.grid, normalizer=ws.normalizer)

Usage in services:
    from src.core.workspace import workspace_filter

    # Returns list of conditions to unpack into .where()
    query = query.where(*workspace_filter(workspace_id))

    # For queries that don't already join Tournament — use apply_workspace_filter
    query = apply_workspace_filter(query, workspace_id, root=models.Encounter)
"""

from shared.services.workspace_scope import (
    ALL_WORKSPACES,
    WorkspaceContext,
    WorkspaceScope,
    apply_workspace_filter,
    get_division_grid,
    get_division_grid_version,
    require_workspace_scope,
    resolve_workspace_context,
    workspace_filter,
)

__all__ = (
    "ALL_WORKSPACES",
    "WorkspaceScope",
    "require_workspace_scope",
    "WorkspaceContext",
    "resolve_workspace_context",
    "workspace_filter",
    "apply_workspace_filter",
    "get_division_grid",
    "get_division_grid_version",
)
