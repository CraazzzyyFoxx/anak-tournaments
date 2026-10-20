"""Per-team roster shape: how many slots of which kind one team has.

The projection of a team format (``shared.domain.team_format.slot_shape``) and the single input of draft, balancer
and slot UI. A slot code is a role code of the discipline's rated dimension or the reserved ``flex`` -- the open slots,
which are not a role.

Deliberately pure: no I/O, no service imports. Looking a shape up for a
tournament or workspace, and caching that lookup, lives elsewhere.

Slot counts are stored as a tuple of pairs rather than a mapping so a shape stays
hashable, JSON-serializable, deep-copyable and picklable -- it travels through
Pydantic into a JSONB column. ``slots`` and ``role_slots`` hand out fresh plain
dicts, so mutating what you get back cannot corrupt the shape.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Final

__all__ = (
    "FLEX_SLOT_CODE",
    "MAX_TEAM_SIZE",
    "MIN_TEAM_SIZE",
    "RosterShape",
    "RosterShapeError",
)

FLEX_SLOT_CODE: Final[str] = "flex"

# A roster shape is a tournament's team format, not a draft setting: 1v1 is a
# legal format. A draft refuses a shape it has nothing to pick for on its own
# (balancer-service ``DraftLifecycleService.create_session``).
MIN_TEAM_SIZE: Final[int] = 1
MAX_TEAM_SIZE: Final[int] = 12


class RosterShapeError(ValueError):
    """An invalid roster slot map, carrying a machine-readable ``code``.

    Subclasses ``ValueError`` so Pydantic ``field_validator`` bodies can let it
    propagate as a validation error instead of a 500.
    """

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code


def _validate_team_size(team_size: int) -> None:
    if not MIN_TEAM_SIZE <= team_size <= MAX_TEAM_SIZE:
        raise RosterShapeError(
            "roster_slots_out_of_range",
            f"Roster size {team_size} is outside {MIN_TEAM_SIZE}..{MAX_TEAM_SIZE}",
        )


@dataclass(frozen=True)
class RosterShape:
    """Normalized per-team slot counts: role slots in format order, open slots last, no zero entries."""

    entries: tuple[tuple[str, int], ...]

    def __post_init__(self) -> None:
        if not isinstance(self.entries, tuple):
            raise RosterShapeError(
                "roster_slots_not_canonical",
                f"Roster shape entries must be a tuple of (slot code, count) pairs, got {type(self.entries).__name__}",
            )
        if not self.entries:
            raise RosterShapeError(
                "roster_slots_empty",
                "A roster shape needs at least one slot with a positive count",
            )

        seen: set[str] = set()
        last = len(self.entries) - 1
        for index, (code, count) in enumerate(self.entries):
            if not isinstance(code, str) or not code:
                raise RosterShapeError(
                    "roster_slots_unknown_code", f"A roster slot code must be a non-empty string, got {code!r}"
                )
            # bool is an int subclass -- True would silently pass as 1.
            if isinstance(count, bool) or not isinstance(count, int) or count < 1:
                raise RosterShapeError(
                    "roster_slots_invalid_count",
                    f"Roster slot {code!r} must be a positive integer, got {count!r}",
                )
            if code in seen or (code == FLEX_SLOT_CODE and index != last):
                raise RosterShapeError(
                    "roster_slots_not_canonical",
                    f"Roster slots must be unique, with the open ({FLEX_SLOT_CODE}) slots last",
                )
            seen.add(code)

        _validate_team_size(self.team_size)

    @property
    def slots(self) -> dict[str, int]:
        """A fresh mutable copy of the slot counts, in canonical order."""
        return dict(self.entries)

    @property
    def team_size(self) -> int:
        return sum(count for _, count in self.entries)

    @property
    def flex_slots(self) -> int:
        return next((count for code, count in self.entries if code == FLEX_SLOT_CODE), 0)

    @property
    def role_slots(self) -> dict[str, int]:
        return {code: count for code, count in self.entries if code != FLEX_SLOT_CODE}

    @property
    def has_role_slots(self) -> bool:
        """False only when every slot is ``flex`` -- the role-less roster.

        This is the switch that hides role counters, role filters and role
        validation. Zero counts are rejected outright, so it can never be
        confused by ``{"tank": 0, "flex": 6}``.
        """
        return any(code != FLEX_SLOT_CODE for code, _ in self.entries)

    @property
    def draft_rounds(self) -> int:
        """Picks this shape needs: the captain already fills one slot.

        ``0`` for a one-slot roster -- such a tournament simply cannot run a draft.
        """
        return self.team_size - 1
