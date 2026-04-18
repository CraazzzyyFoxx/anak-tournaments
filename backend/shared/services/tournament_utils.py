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
