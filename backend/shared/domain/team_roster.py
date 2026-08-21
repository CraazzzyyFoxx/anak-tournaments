"""Slot accounting for a registering team.

Answers the three questions the team-registration flows keep asking, in one place
and without a database:

* may the captain offer one more invite for this slot?
* may this invitee take this slot right now?
* is the roster complete, i.e. materializable?

Two rules here are load-bearing and easy to get backwards.

**A pending invite reserves its slot.** Otherwise a captain can hold ten open
offers for one slot and whoever clicks first wins, with nine people getting an
opaque failure — and the invite table becomes an unmetered spam surface in the
slot dimension. So :meth:`RosterOccupancy.can_offer` counts pending invites.

**Acceptance ignores pending invites.** Including them would make an invite block
its own acceptance. So :meth:`RosterOccupancy.can_accept` counts accepted members
only; the race between two acceptances of the *same* slot is closed by the row
lock the caller holds, not here.

Substitutes are counted on their own axis: they never affect completeness, which
is exactly how the export treats them (``Player.is_substitution`` rows are
excluded from ``Team.avg_sr``/``total_sr``).
"""

from __future__ import annotations

from collections import Counter
from dataclasses import dataclass, field

from shared.domain.roster_shape import ROSTER_SLOT_CODES, RosterShape, RosterShapeError

__all__ = ("RosterMember", "RosterOccupancy")


@dataclass(frozen=True)
class RosterMember:
    """One accepted member or one outstanding invite."""

    slot_code: str
    is_substitute: bool = False


def _validate_slot(shape: RosterShape, slot_code: str) -> None:
    if slot_code not in ROSTER_SLOT_CODES:
        raise RosterShapeError(
            "roster_slots_unknown_code",
            f"Unknown roster slot code {slot_code!r}; valid codes are {', '.join(ROSTER_SLOT_CODES)}",
        )
    if slot_code not in shape.slots:
        raise RosterShapeError(
            "slot_not_in_shape",
            f"This tournament's roster has no {slot_code!r} slot",
        )


@dataclass(frozen=True)
class RosterOccupancy:
    """Who holds which slot on one team, measured against its tournament's shape."""

    shape: RosterShape
    accepted: tuple[RosterMember, ...] = ()
    pending: tuple[RosterMember, ...] = ()
    max_substitutes: int = 0
    _accepted_starters: Counter[str] = field(init=False, repr=False, compare=False)
    _pending_starters: Counter[str] = field(init=False, repr=False, compare=False)

    def __post_init__(self) -> None:
        object.__setattr__(
            self,
            "_accepted_starters",
            Counter(m.slot_code for m in self.accepted if not m.is_substitute),
        )
        object.__setattr__(
            self,
            "_pending_starters",
            Counter(m.slot_code for m in self.pending if not m.is_substitute),
        )

    # ── starters ──────────────────────────────────────────────────────────────

    @property
    def filled_slots(self) -> dict[str, int]:
        """Accepted starters per slot, in canonical order."""
        return {code: self._accepted_starters.get(code, 0) for code in self.shape.slots}

    @property
    def open_slots(self) -> dict[str, int]:
        """Slots with nobody accepted yet — what the roster still *needs*."""
        return {code: count - self._accepted_starters.get(code, 0) for code, count in self.shape.slots.items()}

    @property
    def unoffered_slots(self) -> dict[str, int]:
        """Open slots with no outstanding invite either — what is still *offerable*."""
        return {
            code: count - self._accepted_starters.get(code, 0) - self._pending_starters.get(code, 0)
            for code, count in self.shape.slots.items()
        }

    @property
    def is_complete(self) -> bool:
        """Every starter slot filled. Substitutes are irrelevant to this."""
        return all(remaining <= 0 for remaining in self.open_slots.values())

    # ── substitutes ───────────────────────────────────────────────────────────

    @property
    def accepted_substitutes(self) -> int:
        return sum(1 for m in self.accepted if m.is_substitute)

    @property
    def pending_substitutes(self) -> int:
        return sum(1 for m in self.pending if m.is_substitute)

    @property
    def open_substitute_slots(self) -> int:
        return self.max_substitutes - self.accepted_substitutes

    # ── decisions ─────────────────────────────────────────────────────────────

    def can_offer(self, slot_code: str, *, is_substitute: bool = False) -> bool:
        """May one more invite be issued for this slot? Pending invites reserve."""
        if is_substitute:
            return self.max_substitutes - self.accepted_substitutes - self.pending_substitutes > 0
        _validate_slot(self.shape, slot_code)
        return self.unoffered_slots.get(slot_code, 0) > 0

    def can_accept(self, slot_code: str, *, is_substitute: bool = False) -> bool:
        """May this slot be taken right now? Pending invites do NOT block."""
        if is_substitute:
            return self.open_substitute_slots > 0
        _validate_slot(self.shape, slot_code)
        return self.open_slots.get(slot_code, 0) > 0

    def describe_shortfall(self) -> str:
        """Human-readable "what is still missing", for the captain's view."""
        missing = {code: count for code, count in self.open_slots.items() if count > 0}
        if not missing:
            return "roster complete"
        return ", ".join(f"{count}x {code}" for code, count in missing.items())
