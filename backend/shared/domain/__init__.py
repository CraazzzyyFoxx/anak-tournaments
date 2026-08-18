"""Domain-level business rules shared by backend services."""

from .player_sub_roles import (
    REGISTRATION_ROLE_CODES,
    REGISTRATION_TO_CANONICAL,
    build_subrole_catalog,
    canonical_to_registration_role,
    normalize_role,
    normalize_sub_role,
    registration_to_canonical_role,
)
from .roster_shape import (
    DEFAULT_ROSTER_SHAPE,
    DEFAULT_ROSTER_SLOTS,
    FLEX_SLOT_CODE,
    MAX_TEAM_SIZE,
    MIN_TEAM_SIZE,
    ROSTER_SLOT_CODES,
    RosterShape,
    RosterShapeError,
    parse_roster_slots,
    resolve_roster_shape,
)

__all__ = (
    "DEFAULT_ROSTER_SHAPE",
    "DEFAULT_ROSTER_SLOTS",
    "FLEX_SLOT_CODE",
    "MAX_TEAM_SIZE",
    "MIN_TEAM_SIZE",
    "REGISTRATION_ROLE_CODES",
    "REGISTRATION_TO_CANONICAL",
    "ROSTER_SLOT_CODES",
    "RosterShape",
    "RosterShapeError",
    "build_subrole_catalog",
    "canonical_to_registration_role",
    "normalize_role",
    "normalize_sub_role",
    "parse_roster_slots",
    "registration_to_canonical_role",
    "resolve_roster_shape",
)
