"""Unit tests for what stayed in ``shared.domain.pick_ban_engine`` after the
ruleset-v2 cutover: the round arithmetic, result-dependent rotation (including
the ``elect_opener`` gate), per-map report reconciliation and series scoring.

The step vocabulary, cursor, undo target and eligibility moved to
``shared.domain.pick_ban_rules`` and are covered by that package's suites.
"""

from types import SimpleNamespace

import pytest

from shared.core import enums
from shared.domain import pick_ban_engine as engine


def entry(
    item_id: int,
    *,
    round: int | None = None,
    status: str = "available",
    picked_by: str | None = None,
    protected_by: str | None = None,
    action_index: int | None = None,
):
    return SimpleNamespace(
        item_id=item_id,
        round=round,
        status=status,
        picked_by=picked_by,
        protected_by=protected_by,
        action_index=action_index,
    )


# ── current_round ───────────────────────────────────────────────────────────


def test_current_round_is_lowest_round_with_an_available_entry():
    pool = [entry(1, round=2), entry(2, round=1), entry(3, round=1, status="banned")]
    assert engine.current_round(pool) == 1


def test_current_round_none_for_flat_pool():
    pool = [entry(1, round=None), entry(2, round=None, status="banned")]
    assert engine.current_round(pool) is None


#: Participation ids: the resolved actor vocabulary (§13.4), slot 1 and slot 2.
SLOT1, SLOT2 = 11, 22
SEATS = (SLOT1, SLOT2)


# ── resolve_round_opener (result-dependent rotation) ────────────────────────


def test_round_one_always_uses_the_session_opener_regardless_of_rotation():
    for rotation in enums.FirstBanRotation:
        opener = engine.resolve_round_opener(
            rotation=rotation,
            round_number=1,
            participants=SEATS,
            session_opener=SLOT2,
            previous_round_winner=None,
            previous_round_loser_choice=None,
        )
        assert opener == SLOT2


def test_fixed_rotation_keeps_the_same_opener_every_round():
    opener = engine.resolve_round_opener(
        rotation=enums.FirstBanRotation.FIXED,
        round_number=3,
        participants=SEATS,
        session_opener=SLOT1,
        previous_round_winner=SLOT2,
        previous_round_loser_choice=None,
    )
    assert opener == SLOT1


def test_alternate_rotation_flips_each_round():
    opener_r2 = engine.resolve_round_opener(
        rotation=enums.FirstBanRotation.ALTERNATE,
        round_number=2,
        participants=SEATS,
        session_opener=SLOT1,
        previous_round_winner=None,
        previous_round_loser_choice=None,
    )
    opener_r3 = engine.resolve_round_opener(
        rotation=enums.FirstBanRotation.ALTERNATE,
        round_number=3,
        participants=SEATS,
        session_opener=SLOT1,
        previous_round_winner=None,
        previous_round_loser_choice=None,
    )
    assert opener_r2 == SLOT2
    assert opener_r3 == SLOT1


def test_result_winner_first_uses_previous_winner():
    opener = engine.resolve_round_opener(
        rotation=enums.FirstBanRotation.RESULT_WINNER_FIRST,
        round_number=2,
        participants=SEATS,
        session_opener=SLOT1,
        previous_round_winner=SLOT2,
        previous_round_loser_choice=None,
    )
    assert opener == SLOT2


def test_result_loser_first_uses_the_seat_after_the_previous_winner():
    opener = engine.resolve_round_opener(
        rotation=enums.FirstBanRotation.RESULT_LOSER_FIRST,
        round_number=2,
        participants=SEATS,
        session_opener=SLOT1,
        previous_round_winner=SLOT2,
        previous_round_loser_choice=None,
    )
    assert opener == SLOT1


def test_result_dependent_rotation_falls_back_without_a_previous_winner():
    """A drawn map and an undecided one name no winner; the caller owes the
    round until it is confirmed, and the rotation falls back rather than
    inventing a seat."""
    assert (
        engine.resolve_round_opener(
            rotation=enums.FirstBanRotation.RESULT_WINNER_FIRST,
            round_number=2,
            participants=SEATS,
            session_opener=SLOT1,
            previous_round_winner=None,
            previous_round_loser_choice=None,
        )
        == SLOT1
    )


def test_result_rotations_fall_back_to_the_snapshot_opener_on_a_draw() -> None:
    for rotation in (
        enums.FirstBanRotation.RESULT_WINNER_FIRST,
        enums.FirstBanRotation.RESULT_LOSER_FIRST,
        enums.FirstBanRotation.RESULT_LOSER_CHOICE,
    ):
        assert (
            engine.resolve_round_opener(
                rotation=rotation,
                round_number=2,
                participants=SEATS,
                session_opener=SLOT2,
                previous_round_winner=None,
                previous_round_loser_choice=None,
            )
            == SLOT2
        )


def test_an_opener_outside_the_card_is_a_caller_bug() -> None:
    with pytest.raises(ValueError, match="not one of this encounter"):
        engine.resolve_round_opener(
            rotation=enums.FirstBanRotation.FIXED,
            round_number=2,
            participants=SEATS,
            session_opener=999,
            previous_round_winner=None,
            previous_round_loser_choice=None,
        )


def test_result_loser_choice_raises_needs_choice_when_unresolved():
    with pytest.raises(engine.RotationNeedsChoice):
        engine.resolve_round_opener(
            rotation=enums.FirstBanRotation.RESULT_LOSER_CHOICE,
            round_number=2,
            participants=SEATS,
            session_opener=SLOT1,
            previous_round_winner=SLOT2,
            previous_round_loser_choice=None,
        )


def test_result_loser_choice_returns_the_elected_participation_once_chosen():
    opener = engine.resolve_round_opener(
        rotation=enums.FirstBanRotation.RESULT_LOSER_CHOICE,
        round_number=2,
        participants=SEATS,
        session_opener=SLOT1,
        previous_round_winner=SLOT2,
        previous_round_loser_choice=SLOT1,
    )
    assert opener == SLOT1
