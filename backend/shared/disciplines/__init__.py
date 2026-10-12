"""What the code knows about a discipline, beside what the DB stores (D25, D48).

``catalog.discipline`` is the row every owner's ``discipline`` column
references; this is the behaviour behind that code. V1 declares one thing:
whether the game has SIDES, and which. Overwatch does not -- a map is played
attack/defence per round, not per team -- so ``sides`` is empty and a ruleset
may not contain a ``side_pick`` step for it.

Pure data, no DB: the pick-ban engine, the ruleset validator and the game
writer all read it, and none of them may do IO to answer "does this game have
sides".
"""

from __future__ import annotations

from dataclasses import dataclass

__all__ = ("DISCIPLINES", "DisciplineSpec", "discipline")


@dataclass(frozen=True, slots=True)
class DisciplineSpec:
    code: str
    name: str
    #: Side codes a game of this discipline starts on, in declaration order;
    #: ``()`` when the game has no sides. A ``side_pick`` step is legal only
    #: when this has exactly as many entries as the game has participants.
    sides: tuple[str, ...] = ()


DISCIPLINES: dict[str, DisciplineSpec] = {
    "overwatch": DisciplineSpec("overwatch", "Overwatch", ()),
}


def discipline(code: str) -> DisciplineSpec:
    """The spec for ``code``, or a side-less stand-in for a code V1 does not
    know. Unknown is not an error: ``catalog.discipline`` is the authority on
    which codes exist, and a discipline nobody has written behaviour for simply
    has none -- refusing here would take down every encounter of it."""
    return DISCIPLINES.get(code) or DisciplineSpec(code, code, ())
