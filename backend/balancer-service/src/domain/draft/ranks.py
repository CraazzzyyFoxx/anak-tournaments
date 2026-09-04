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

from shared.core.enums import HeroClass
from shared.domain.roster import PlayerRoster
from shared.domain.roster_shape import RosterShape

__all__ = ("slot_rank",)


def slot_rank(roster: PlayerRoster | None, role: HeroClass | str | None, shape: RosterShape) -> int | None:
    """The rank ``roster`` is worth on its slot under ``shape``.

    ``role=None`` is the honest input for a player holding no role yet -- a pool
    card, or a captain seeded straight onto a roster -- and answers the player's
    best playable rank, exactly as a role-less shape does for everybody.
    """
    if roster is None:
        return None
    return roster.rank_on(role if shape.has_role_slots else None)
