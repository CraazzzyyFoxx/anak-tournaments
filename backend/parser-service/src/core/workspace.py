"""
Workspace filtering utilities for SQLAlchemy queries.

Re-exports ``shared.services.workspace_scope`` — the single source of truth
for every service's workspace-filtering helpers.

Usage (in services — returns list of conditions to unpack into .where()):
    from src.core.workspace import workspace_filter

    query = query.where(*workspace_filter(workspace_id))
"""

from shared.services.workspace_scope import get_division_grid, get_division_grid_version, workspace_filter

__all__ = ("workspace_filter", "get_division_grid", "get_division_grid_version")
