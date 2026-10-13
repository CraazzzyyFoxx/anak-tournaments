"""How a recorded mix round is read: who won, from the two scores it stores."""

from __future__ import annotations

__all__ = ("winner_slot",)


def winner_slot(slot: int, own_score: float, other_score: float) -> int | None:
    """The winning slot (1 | 2) of a round, ``None`` for a draw -- the one place that reads it off the scores.

    ``slot`` is the side ``own_score`` belongs to (a ``seats()`` row's ``slot``/``own_score``/``other_score``; for a
    round's two teams pass slot 1 with the first team's score first).
    """
    if own_score == other_score:
        return None
    return slot if own_score > other_score else 3 - slot
