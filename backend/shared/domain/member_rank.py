"""Rank layering: which of a member's several rank sources wins.

Callers pass the layers in their own order, because the two contexts disagree:
a mix trusts the host's private book above the workspace canon, a tournament
trusts the number the organiser put on the registration.

An *absent* layer is what makes inheritance work — a layer holding ``None``
falls through, so "follow the workspace rank" is the absence of a row rather
than a copy of its value.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from typing import Literal

__all__ = ("RankScope", "RankSource", "ResolvedRank", "pick_rank")

#: Where a rank can come from, named after the thing that owns it.
#:
#: ``author``       -- one account's private book (its own mixes only)
#: ``registration`` -- the number on the tournament registration
#: ``workspace``    -- the workspace canon, visible to everyone
#: ``native``       -- the game's own ladder (the module's ``native_ranks``), normalised to the division grid
RankScope = Literal["author", "registration", "workspace", "native"]

RankSource = RankScope | Literal["none"]


@dataclass(frozen=True, slots=True)
class ResolvedRank:
    value: int | None
    source: RankSource


_UNRANKED = ResolvedRank(None, "none")


def pick_rank(layers: Sequence[tuple[RankScope, int | None]]) -> ResolvedRank:
    """First layer carrying a value wins. ``layers`` is already in priority order."""
    for scope, value in layers:
        if value is not None:
            return ResolvedRank(value, scope)
    return _UNRANKED
