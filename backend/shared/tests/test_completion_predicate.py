"""One predicate decides whether an encounter has been played.

Three places used to ask the question with their own OR of ``status`` and
``result_status``. The risk was never the OR itself but that each call site was
free to phrase it differently — an AND here, one column there — so the same
encounter could count as played for standings and not for Swiss round-advance
readiness. Since ``encres0001`` a CHECK constraint makes the two columns
equivalent, so the question has exactly one form and these tests pin it.
"""

from __future__ import annotations

from types import SimpleNamespace

import pytest

from shared.core import enums
from shared.domain.tournament_utils import (
    completed_encounters,
    completed_encounters_in_finished_rounds,
    has_incomplete_playable_rounds,
    is_completed_encounter,
)


def _encounter(*, status, result_status, encounter_id: int = 1) -> SimpleNamespace:
    return SimpleNamespace(
        id=encounter_id,
        status=status,
        result_status=result_status,
    )


class TestIsCompletedEncounter:
    def test_a_completed_encounter_counts(self):
        encounter = _encounter(
            status=enums.EncounterStatus.COMPLETED,
            result_status=enums.EncounterResultStatus.CONFIRMED,
        )
        assert is_completed_encounter(encounter)

    @pytest.mark.parametrize(
        "status",
        [enums.EncounterStatus.OPEN, enums.EncounterStatus.PENDING],
    )
    def test_an_unfinished_encounter_does_not(self, status):
        encounter = _encounter(status=status, result_status=enums.EncounterResultStatus.NONE)
        assert not is_completed_encounter(encounter)

    @pytest.mark.parametrize(
        "result_status",
        [
            enums.EncounterResultStatus.PENDING_CONFIRMATION,
            enums.EncounterResultStatus.DISPUTED,
        ],
    )
    def test_a_result_still_under_discussion_does_not(self, result_status):
        """One report in, or two that disagree: the encounter is not played yet,
        and the constraint keeps ``status`` OPEN behind that."""
        encounter = _encounter(status=enums.EncounterStatus.OPEN, result_status=result_status)
        assert not is_completed_encounter(encounter)

    def test_an_encounter_with_no_result_never_counts(self):
        """An unfilled bracket slot has no participation at all, so it cannot
        have been played -- and the CHECK behind ``status`` is what says so."""
        encounter = _encounter(
            status=enums.EncounterStatus.OPEN,
            result_status=enums.EncounterResultStatus.NONE,
        )
        assert not is_completed_encounter(encounter)


class TestCompletedEncounters:
    def test_filters_through_the_same_predicate(self):
        played = _encounter(
            status=enums.EncounterStatus.COMPLETED,
            result_status=enums.EncounterResultStatus.CONFIRMED,
        )
        unplayed = _encounter(
            status=enums.EncounterStatus.OPEN,
            result_status=enums.EncounterResultStatus.NONE,
        )
        assert completed_encounters([played, unplayed]) == [played]


class TestPlayableRounds:
    """The round lives on ``tournament.bracket_encounter`` now, so the caller
    hands it in -- and the mapping IS the playable set: an encounter it leaves
    out (no bracket position, or a seat still waiting upstream) is ignored,
    exactly as a missing team used to be."""

    def _round(self, encounter_id: int, *, played: bool):
        return _encounter(
            encounter_id=encounter_id,
            status=enums.EncounterStatus.COMPLETED if played else enums.EncounterStatus.OPEN,
            result_status=(enums.EncounterResultStatus.CONFIRMED if played else enums.EncounterResultStatus.NONE),
        )

    def test_only_a_round_with_nothing_left_counts(self):
        closed_a = self._round(1, played=True)
        closed_b = self._round(2, played=True)
        open_one = self._round(3, played=False)
        encounters = [closed_a, closed_b, open_one]
        rounds = {1: 1, 2: 1, 3: 2}

        assert completed_encounters_in_finished_rounds(encounters, rounds) == [closed_a, closed_b]
        assert has_incomplete_playable_rounds(encounters, rounds)

    def test_an_encounter_outside_the_mapping_holds_nothing_up(self):
        played = self._round(1, played=True)
        not_playable = self._round(2, played=False)
        rounds = {1: 1}

        assert completed_encounters_in_finished_rounds([played, not_playable], rounds) == [played]
        assert not has_incomplete_playable_rounds([played, not_playable], rounds)
