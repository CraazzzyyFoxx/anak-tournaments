"""Authentication dependencies for app-service (DB-backed user resolution).

Re-exports ``shared.rbac.workspace_lookup`` — identical body to
parser-service's (and, until this consolidation, analytics-service's) own
``_resolve_user_from_db``.
"""

from shared.rbac.workspace_lookup import resolve_user_from_db as _resolve_user_from_db

__all__ = ("_resolve_user_from_db",)
