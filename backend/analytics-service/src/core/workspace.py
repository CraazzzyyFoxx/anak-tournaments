"""
Workspace filtering utilities for SQLAlchemy queries.

Re-exports ``shared.services.workspace_scope`` — the single source of truth
for every service's workspace-filtering helpers. This module used to say
"Mirrors parser-service/src/core/workspace.py — kept locally so v1 analytics
code ... keeps working"; that mirroring is now resolved by importing the one
canonical implementation instead of a second copy.
"""

from shared.services.workspace_scope import (
    get_division_grid,
    get_division_grid_version,
    get_tournament_workspace_id,
    workspace_filter,
    workspace_filter_any,
    workspace_scope_filter,
)

__all__ = (
    "workspace_filter",
    "workspace_filter_any",
    "workspace_scope_filter",
    "get_tournament_workspace_id",
    "get_division_grid",
    "get_division_grid_version",
)
