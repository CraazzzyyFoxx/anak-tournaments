from .bootstrap import (
    assign_default_member_role_if_roleless,
    assign_workspace_system_role,
    ensure_permission_catalog,
    ensure_workspace_system_roles,
    get_workspace_system_role,
    replace_user_workspace_roles,
    user_has_any_workspace_role,
    user_has_only_workspace_owner_role,
    workspace_names_blocking_player_unlink,
)
from .catalog import (
    PERMISSION_CATALOG,
    WORKSPACE_SYSTEM_ROLE_NAMES,
    PermissionSpec,
    permission_names_for_workspace_role,
)
from .scopes import (
    ALL_SCOPE_NAMES,
    LEGACY_SCOPE_ALIASES,
    SCOPE_PAIRS,
    normalize_scopes,
    scope_grants,
    scope_pairs,
    unknown_scopes,
)

__all__ = (
    "ALL_SCOPE_NAMES",
    "LEGACY_SCOPE_ALIASES",
    "PERMISSION_CATALOG",
    "SCOPE_PAIRS",
    "WORKSPACE_SYSTEM_ROLE_NAMES",
    "PermissionSpec",
    "assign_default_member_role_if_roleless",
    "assign_workspace_system_role",
    "ensure_permission_catalog",
    "ensure_workspace_system_roles",
    "get_workspace_system_role",
    "normalize_scopes",
    "permission_names_for_workspace_role",
    "replace_user_workspace_roles",
    "scope_grants",
    "scope_pairs",
    "unknown_scopes",
    "user_has_any_workspace_role",
    "user_has_only_workspace_owner_role",
    "workspace_names_blocking_player_unlink",
)
