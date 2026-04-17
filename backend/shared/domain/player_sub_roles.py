from __future__ import annotations

import re
from enum import Enum
from typing import Any

LEGACY_HITSCAN_SUB_ROLE = "hitscan"
LEGACY_PROJECTILE_SUB_ROLE = "projectile"
LEGACY_MAIN_HEAL_SUB_ROLE = "main_heal"
LEGACY_LIGHT_HEAL_SUB_ROLE = "light_heal"

LEGACY_PRIMARY_SUB_ROLES = frozenset(
    {LEGACY_HITSCAN_SUB_ROLE, LEGACY_MAIN_HEAL_SUB_ROLE}
)
LEGACY_SECONDARY_SUB_ROLES = frozenset(
    {LEGACY_PROJECTILE_SUB_ROLE, LEGACY_LIGHT_HEAL_SUB_ROLE}
)

_DAMAGE_ROLE_ALIASES = frozenset({"damage", "dps"})
_SUPPORT_ROLE_ALIASES = frozenset({"support", "heal", "healer"})


def normalize_role(role: Any) -> str | None:
    if role is None:
        return None

    if isinstance(role, Enum):
        role = role.value

    value = str(role).strip().lower()
    if value in _DAMAGE_ROLE_ALIASES:
        return "damage"
    if value in _SUPPORT_ROLE_ALIASES:
        return "support"
    if value == "tank":
        return "tank"

    return value or None


def normalize_sub_role(sub_role: str | None) -> str | None:
    if sub_role is None:
        return None

    normalized = re.sub(r"\s+", "_", sub_role.strip().lower())
    return normalized or None


def legacy_flags_to_sub_role(
    role: Any,
    *,
    primary: bool | None,
    secondary: bool | None,
) -> str | None:
    role_key = normalize_role(role)
    is_primary = bool(primary)
    is_secondary = bool(secondary)

    if is_primary == is_secondary:
        return None

    if role_key == "damage":
        return LEGACY_HITSCAN_SUB_ROLE if is_primary else LEGACY_PROJECTILE_SUB_ROLE
    if role_key == "support":
        return LEGACY_MAIN_HEAL_SUB_ROLE if is_primary else LEGACY_LIGHT_HEAL_SUB_ROLE

    return None


def sub_role_to_legacy_flags(role: Any, sub_role: str | None) -> tuple[bool, bool]:
    role_key = normalize_role(role)
    sub_role_key = normalize_sub_role(sub_role)

    if role_key == "damage":
        if sub_role_key == LEGACY_HITSCAN_SUB_ROLE:
            return (True, False)
        if sub_role_key == LEGACY_PROJECTILE_SUB_ROLE:
            return (False, True)

    if role_key == "support":
        if sub_role_key == LEGACY_MAIN_HEAL_SUB_ROLE:
            return (True, False)
        if sub_role_key == LEGACY_LIGHT_HEAL_SUB_ROLE:
            return (False, True)

    return (False, False)


def resolve_sub_role(
    role: Any,
    *,
    sub_role: str | None,
    primary: bool | None,
    secondary: bool | None,
) -> str | None:
    return normalize_sub_role(sub_role) or legacy_flags_to_sub_role(
        role,
        primary=primary,
        secondary=secondary,
    )
