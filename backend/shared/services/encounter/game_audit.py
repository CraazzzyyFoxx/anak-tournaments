"""Retiring a position of a series (D64).

A cancelled game keeps its position as history and is never revived; a replayed
position is a new row. The journal entry that goes with it is not written here:
dropping a confirmed game's points IS a change to the encounter's standing, and
every one of those goes through the single result writer
(:mod:`shared.services.encounter.result`) so it gets one version and one row,
like every other result change.

Shared because both the admin path and the bracket's cascade reset cancel
games, and two copies of "which states may still be retired" would drift.
"""

from __future__ import annotations

from collections.abc import Sequence

from shared.core.enums import EncounterGameState
from shared.models.encounter.game import EncounterGame

__all__ = ("cancel_games",)


def cancel_games(games: Sequence[EncounterGame]) -> list[EncounterGame]:
    """Retire every game that is not already cancelled; returns the ones moved.

    The caller owns the filtering (``vacate_slot`` keeps confirmed games, a
    bracket reset does not) and owns re-materializing the standing afterwards.
    An empty return means nothing changed, so no result write is owed.
    """
    changed = [game for game in games if game.state != EncounterGameState.CANCELLED]
    for game in changed:
        game.state = EncounterGameState.CANCELLED
    return changed
