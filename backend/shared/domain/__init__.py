"""Domain-level business rules shared by backend services."""

from .player_sub_roles import (
    LEGACY_PRIMARY_SUB_ROLES,
    LEGACY_SECONDARY_SUB_ROLES,
    legacy_flags_to_sub_role,
    normalize_role,
    normalize_sub_role,
    resolve_sub_role,
    sub_role_to_legacy_flags,
)

__all__ = (
    "LEGACY_PRIMARY_SUB_ROLES",
    "LEGACY_SECONDARY_SUB_ROLES",
    "legacy_flags_to_sub_role",
    "normalize_role",
    "normalize_sub_role",
    "resolve_sub_role",
    "sub_role_to_legacy_flags",
)
