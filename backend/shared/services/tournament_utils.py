"""Shared tournament utility functions used by both parser-service and
app-service (Phase E consolidation).

Eliminates the duplication of ``sort_matches`` and ``_completed_encounters``
between parser-service/services/standings/service.py,
parser-service/services/standings/flows.py and
app-service/services/standings/flows.py.
"""

from __future__ import annotations

import typing
from collections.abc import Sequence

from shared.core import enums
from shared.models.encounter import Encounter

__all__ = (
    "sort_bracket_matches",
    "is_completed_encounter",
    "completed_encounters",
    "completed_encounters_in_finished_rounds",
    "has_incomplete_playable_rounds",
)


def is_completed_encounter(encounter: Encounter) -> bool:
    """Canonical "this encounter counts toward standings" predicate.

    Phase B: the single source of truth is ``status == COMPLETED``.
    ``result_status == CONFIRMED`` also counts (captain submission flow).
    Non-zero scores alone do NOT — that rule previously masked state desyncs.
    """
    if encounter.home_team_id is None or encounter.away_team_id is None:
        return False
    return (
        encounter.status == enums.EncounterStatus.COMPLETED
        or encounter.result_status == enums.EncounterResultStatus.CONFIRMED
    )


def completed_encounters(
    encounters: Sequence[Encounter],
) -> list[Encounter]:
    """Filter encounters through :func:`is_completed_encounter`."""
    return [e for e in encounters if is_completed_encounter(e)]


def _playable_rounds(
    encounters: Sequence[Encounter],
) -> dict[int, list[Encounter]]:
    rounds: dict[int, list[Encounter]] = {}
    for encounter in encounters:
        if encounter.home_team_id is None or encounter.away_team_id is None:
            continue
        rounds.setdefault(encounter.round, []).append(encounter)
    return rounds


def completed_encounters_in_finished_rounds(
    encounters: Sequence[Encounter],
) -> list[Encounter]:
    """Return completed encounters that belong to fully closed playable rounds.

    A round is considered playable only when both participants are known.
    If at least one playable encounter in a round is still open/pending, the
    whole round is ignored for standings/reseeding purposes.
    """
    completed: list[Encounter] = []
    for round_encounters in _playable_rounds(encounters).values():
        if all(is_completed_encounter(encounter) for encounter in round_encounters):
            completed.extend(round_encounters)
    return completed


def has_incomplete_playable_rounds(
    encounters: Sequence[Encounter],
) -> bool:
    """Return True when any playable round still has unfinished encounters."""
    return any(
        any(not is_completed_encounter(encounter) for encounter in round_encounters)
        for round_encounters in _playable_rounds(encounters).values()
    )


def sort_bracket_matches(
    matches: Sequence[typing.Any],
) -> list[typing.Any]:
    """Order encounters/pairings so the final match is last and negative-round
    (LB) matches follow their positive-round (UB) counterparts of the same
    absolute round number.

    Works with any object that has a ``round`` attribute (models.Encounter,
    schemas.EncounterRead, bracket Pairing).
    """
    if not matches:
        return []

    max_abs_round = max(abs(m.round) for m in matches)

    def sort_key(match: typing.Any) -> tuple[int, int, int]:
        final_flag = 1 if abs(match.round) == max_abs_round else 0
        # Positive rounds (upper bracket) come before negative (lower) of same
        # absolute magnitude.
        ub_first = 0 if match.round > 0 else 1
        return final_flag, abs(match.round), ub_first

    return sorted(matches, key=sort_key)
