"""Encounter-completion and bracket-round helpers shared by stats-service and app-service."""

from __future__ import annotations

import typing
from collections.abc import Mapping, Sequence

from shared.core import enums
from shared.models.encounter.encounter import Encounter

__all__ = (
    "sort_bracket_matches",
    "is_completed_encounter",
    "completed_encounters",
    "completed_encounters_in_finished_rounds",
    "has_incomplete_playable_rounds",
    "get_double_elimination_round_order",
)


def is_completed_encounter(encounter: Encounter) -> bool:
    """Canonical "this encounter counts toward standings" predicate.

    ``status == COMPLETED`` is the single form: a CHECK constraint makes it
    equivalent to ``result_status == CONFIRMED``. Non-zero scores alone do NOT
    count: they would mask state desyncs.

    Whether both seats are filled is not asked: an unplaced seat has no
    participation row at all, and an encounter that was never played cannot be
    COMPLETED.
    """
    return encounter.status == enums.EncounterStatus.COMPLETED


def completed_encounters(
    encounters: Sequence[Encounter],
) -> list[Encounter]:
    """Filter encounters through :func:`is_completed_encounter`."""
    return [e for e in encounters if is_completed_encounter(e)]


def _playable_rounds(
    encounters: Sequence[Encounter],
    rounds: Mapping[int, int],
) -> dict[int, list[Encounter]]:
    """Group the playable encounters by bracket round.

    ``rounds`` maps encounter id to its ``tournament.bracket_encounter.round``
    and IS the playable set: the round lives off the encounter, and whether
    every seat of a fixture is filled is a participation query only the caller
    can run. An encounter the caller left out — no bracket position, or a seat
    still waiting on an upstream result — is skipped.
    """
    grouped: dict[int, list[Encounter]] = {}
    for encounter in encounters:
        round_number = rounds.get(encounter.id)
        if round_number is None:
            continue
        grouped.setdefault(round_number, []).append(encounter)
    return grouped


def completed_encounters_in_finished_rounds(
    encounters: Sequence[Encounter],
    rounds: Mapping[int, int],
) -> list[Encounter]:
    """Return completed encounters that belong to fully closed playable rounds.

    ``rounds`` is the playable set, keyed by encounter id — see
    :func:`_playable_rounds`. If at least one playable encounter in a round is
    still open/pending, the whole round is ignored for standings/reseeding.
    """
    completed: list[Encounter] = []
    for round_encounters in _playable_rounds(encounters, rounds).values():
        if all(is_completed_encounter(encounter) for encounter in round_encounters):
            completed.extend(round_encounters)
    return completed


def has_incomplete_playable_rounds(
    encounters: Sequence[Encounter],
    rounds: Mapping[int, int],
) -> bool:
    """Return True when any playable round still has unfinished encounters."""
    return any(
        any(not is_completed_encounter(encounter) for encounter in round_encounters)
        for round_encounters in _playable_rounds(encounters, rounds).values()
    )


def get_double_elimination_round_order(round_num: int) -> float:
    """Returns a chronological order score for a given round number in a
    Double Elimination bracket. Smaller values indicate earlier rounds.

    Progression:
      - UB R1 (1) -> LB R1 (-1)
      - UB R2 (2) -> LB R2 (-2) -> LB R3 (-3)
      - UB R3 (3) -> LB R4 (-4) -> LB R5 (-5)
      - UB R4 (4) -> LB R6 (-6) -> LB R7 (-7)
      ...
    """
    if round_num == 1:
        return 1.0
    elif round_num == -1:
        return 2.0
    elif round_num > 1:
        return 3.0 * round_num - 3.0
    elif round_num < -1:
        val = abs(round_num)
        if val % 2 == 0:
            k = val // 2
            return 3.0 * k + 1.0
        else:
            k = (val - 1) // 2
            return 3.0 * k + 2.0
    return 0.0


def sort_bracket_matches(
    matches: Sequence[typing.Any],
) -> list[typing.Any]:
    """Order encounters/pairings so the matches are sorted chronologically
    by their round number, handling both upper (positive) and lower (negative)
    bracket rounds correctly.

    Works with any object that has a ``round`` attribute (models.Encounter,
    schemas.EncounterRead, bracket Pairing).
    """
    if not matches:
        return []

    # Check if there are any negative rounds, which implies Double Elimination
    has_negative_rounds = any(m.round < 0 for m in matches)

    def sort_key(match: typing.Any) -> tuple[float, int]:
        match_id = getattr(match, "id", 0) or 0
        if has_negative_rounds:
            return get_double_elimination_round_order(match.round), match_id
        else:
            # For non-Double Elimination stages, sort by round number ascending
            return float(match.round), match_id

    return sorted(matches, key=sort_key)
