"""Per-team roster shape: how many slots of which kind one team has.

The single source of truth for team composition across draft, balancer and UI.
A slot code is either a registration role (``tank``/``dps``/``support``) or the
reserved ``flex`` code, meaning "any role fits this slot".

Deliberately pure: no I/O, no service imports. The tournament/workspace lookup
and its cache live in ``shared.services.roster_shape_access``.
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from types import MappingProxyType
from typing import Any

from shared.domain.player_sub_roles import REGISTRATION_ROLE_CODES

__all__ = (
    "DEFAULT_ROSTER_SLOTS",
    "FLEX_SLOT_CODE",
    "MAX_TEAM_SIZE",
    "MIN_TEAM_SIZE",
    "ROSTER_SLOT_CODES",
    "RosterShape",
    "RosterShapeError",
    "parse_roster_slots",
)

FLEX_SLOT_CODE = "flex"
ROSTER_SLOT_CODES: tuple[str, ...] = (*REGISTRATION_ROLE_CODES, FLEX_SLOT_CODE)
DEFAULT_ROSTER_SLOTS: dict[str, int] = {"tank": 1, "dps": 2, "support": 2}
MIN_TEAM_SIZE = 1
MAX_TEAM_SIZE = 12


class RosterShapeError(ValueError):
    """An invalid roster slot map, carrying a machine-readable ``code``.

    Subclasses ``ValueError`` so Pydantic ``field_validator`` bodies can let it
    propagate as a validation error instead of a 500.
    """

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code


@dataclass(frozen=True)
class RosterShape:
    """Normalized per-team slot counts: canonical key order, no zero entries."""

    slots: Mapping[str, int]

    @property
    def team_size(self) -> int:
        return sum(self.slots.values())

    @property
    def flex_slots(self) -> int:
        return self.slots.get(FLEX_SLOT_CODE, 0)

    @property
    def role_slots(self) -> Mapping[str, int]:
        return MappingProxyType(
            {code: count for code, count in self.slots.items() if code != FLEX_SLOT_CODE}
        )

    @property
    def has_role_slots(self) -> bool:
        """False only when every slot is ``flex`` -- the role-less roster.

        This is the switch that hides role counters, role filters and role
        validation. ``parse_roster_slots`` drops zero counts, so it can never be
        confused by ``{"tank": 0, "flex": 6}``.
        """
        return bool(self.role_slots)

    @property
    def draft_rounds(self) -> int:
        """Draft rounds for this shape: the captain already fills one slot."""
        return max(1, self.team_size - 1)

    def to_dict(self) -> dict[str, int]:
        return dict(self.slots)

    def __hash__(self) -> int:
        return hash(tuple(self.slots.items()))


def parse_roster_slots(raw: Any) -> RosterShape:
    """Validate and normalize a raw slot map into a ``RosterShape``."""
    if not isinstance(raw, Mapping):
        raise RosterShapeError(
            "roster_slots_not_a_map",
            f"Roster slots must be a mapping of slot code to count, got {type(raw).__name__}",
        )

    counts: dict[str, int] = {}
    for code, value in raw.items():
        if code not in ROSTER_SLOT_CODES:
            raise RosterShapeError(
                "roster_slots_unknown_code",
                f"Unknown roster slot code {code!r}; valid codes are {', '.join(ROSTER_SLOT_CODES)}",
            )
        # bool is an int subclass -- True would silently pass as 1.
        if isinstance(value, bool) or not isinstance(value, int) or value < 0:
            raise RosterShapeError(
                "roster_slots_invalid_count",
                f"Roster slot {code!r} must be a non-negative integer, got {value!r}",
            )
        if value > 0:
            counts[code] = value

    if not counts:
        raise RosterShapeError(
            "roster_slots_empty",
            "A roster shape needs at least one slot with a positive count",
        )

    team_size = sum(counts.values())
    if not MIN_TEAM_SIZE <= team_size <= MAX_TEAM_SIZE:
        raise RosterShapeError(
            "roster_slots_out_of_range",
            f"Roster size {team_size} is outside {MIN_TEAM_SIZE}..{MAX_TEAM_SIZE}",
        )

    ordered = {code: counts[code] for code in ROSTER_SLOT_CODES if code in counts}
    return RosterShape(slots=MappingProxyType(ordered))
