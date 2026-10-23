"""Who bans first in a mix match (spec §8.3). Seat order is the ban order: the opener sits in slot 1."""

from __future__ import annotations

from collections.abc import Sequence

__all__ = ("ban_opener",)


def ban_opener(
    teams: Sequence[Sequence[tuple[int, int]]], previous: Sequence[tuple[frozenset[int], float]] | None
) -> int:
    """The lineup team (0 or 1) that opens the bans.

    ``teams`` are the lineup's two teams as ``(member id, rating)``; ``previous`` is the lobby's last recorded round
    as ``(members, score)`` per slot, or ``None``. The same two teams as last time: last time's loser opens.
    Otherwise, or after a draw, the team with the lower average rating opens; an even split opens with the first.
    """
    members = [frozenset(member for member, _rating in team) for team in teams]
    if previous is not None and {seat for seat, _score in previous} == set(members):
        (first, first_score), (second, second_score) = previous
        if first_score != second_score:
            return members.index(first if first_score < second_score else second)
    averages = [sum(rating for _member, rating in team) / len(team) if team else 0.0 for team in teams]
    return 1 if averages[1] < averages[0] else 0
