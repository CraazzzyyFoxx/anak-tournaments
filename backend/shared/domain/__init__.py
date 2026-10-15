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
    FLEX_SLOT_CODE,
    MAX_TEAM_SIZE,
    MIN_TEAM_SIZE,
    RosterShape,
    RosterShapeError,
)

__all__ = (
    "FLEX_SLOT_CODE",
    "MAX_TEAM_SIZE",
    "MIN_TEAM_SIZE",
    "REGISTRATION_ROLE_CODES",
    "REGISTRATION_TO_CANONICAL",
    "RosterShape",
    "RosterShapeError",
    "build_subrole_catalog",
    "canonical_to_registration_role",
    "normalize_role",
    "normalize_sub_role",
    "registration_to_canonical_role",
)
