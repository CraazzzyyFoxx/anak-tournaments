"""The one draft-side rank rule: which rank a roster SLOT is worth.

Rank itself is not computed here and is not stored anywhere in the draft --
``shared.services.roster`` resolves it once per request and
``PlayerRoster.rank_on`` answers it. All that is left is the shape question,
which is a draft concept and cannot live in the engine: a roster with role
slots values a player at the rank of the role they fill, a role-less (all-flex)
roster assigns nobody a role and therefore values them at their strongest.

One function, so the frozen pick, the team export and the board snapshot cannot
disagree about the rank a flex draft shows.
"""

from __future__ import annotations

from shared.domain.roster import PlayerRoster
from shared.domain.roster_shape import RosterShape

__all__ = ("captain_rank", "drafted_rank", "seat_role", "slot_rank")


def slot_rank(roster: PlayerRoster | None, role: str | None, shape: RosterShape) -> int | None:
    """The rank ``roster`` is worth on its slot under ``shape``.

    ``role=None`` is the honest input for a player holding no role yet -- a pool
    card, or a captain seeded straight onto a roster -- and answers the player's
    best playable rank, exactly as a role-less shape does for everybody.
    """
    if roster is None:
        return None
    return roster.rank_on(role if shape.has_role_slots else None)


def seat_role(roster: PlayerRoster | None, pinned: str | None = None) -> str | None:
    """The role a rostered player holds when no pick froze one.

    ``pinned`` is ``DraftPlayer.captain_role``: the role the organizer seated a
    captain on. It holds while the registration can still play it; a pin whose
    rank was cleared since, and every seat without one, fall back to the lead
    role (flagged primary, else the first playable). ``None`` only for a roster
    that can play nothing, which feasibility reports rather than guesses.
    """
    if roster is None:
        return None
    if pinned in roster.playable_roles:
        return pinned
    lead = roster.primary
    return lead.role if lead is not None else None


def captain_rank(roster: PlayerRoster | None, pinned: str | None, shape: RosterShape) -> int:
    """What a captain is worth when captains are ordered by strength.

    The rank of the role they are seated on -- the same number the captain step
    and the board show -- not their strongest role: a support main seated on
    support is not worth their damage rank. A role-less shape answers the best
    rank, as ``slot_rank`` does for everybody. ``-1`` for an unranked captain,
    so they sort as the weakest.
    """
    return slot_rank(roster, seat_role(roster, pinned), shape) or -1


def drafted_rank(roster: PlayerRoster | None, role: str | None, shape: RosterShape, *, frozen: int | None) -> int:
    """What a rostered player adds to their team's total; ``0`` when unranked.

    ``frozen`` is the pick's ``target_rank_value`` -- the one derivation the draft
    stores, because it is a fact about a pick that happened. A captain has no
    pick, so ``role`` is their seat role and the rank is live. A role-less shape
    ignores the frozen value: it was frozen against a role the shape gives no
    meaning to, so ``slot_rank`` re-derives the maximum every other reader shows.
    """
    if frozen is not None and shape.has_role_slots:
        return frozen
    return slot_rank(roster, role, shape) or 0
