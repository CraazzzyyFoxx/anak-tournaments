"""The discipline registry and the actor vocabulary that reads it (D25, §13.4).

Overwatch declares no sides, so the whole ``side_pick``/``side:<code>`` half of
the vocabulary is refused for it -- which is the point of the registry: a game
with sides is a V3 discipline, and V1 must not let a ruleset pretend otherwise.
"""

from __future__ import annotations

import pytest

from shared.disciplines import DISCIPLINES, DisciplineSpec, discipline
from shared.domain import pick_ban_rules as pbr

#: Participation ids: resolved actors are participations, never sides.
SLOT1, SLOT2 = 11, 22
SEATS = (SLOT1, SLOT2)

#: A stand-in for the first discipline that DOES have sides. V1 ships none, so
#: the side half of the vocabulary is exercised against this rather than left
#: untested until V3.
SIDED = DisciplineSpec("sided", "Sided Game", ("attack", "defence"))


@pytest.fixture
def sided_discipline():
    DISCIPLINES[SIDED.code] = SIDED
    try:
        yield SIDED
    finally:
        DISCIPLINES.pop(SIDED.code, None)


# ── the registry ────────────────────────────────────────────────────────────


def test_overwatch_declares_no_sides():
    spec = discipline("overwatch")
    assert (spec.code, spec.name, spec.sides) == ("overwatch", "Overwatch", ())


def test_an_unknown_code_resolves_to_a_side_less_stand_in():
    """``catalog.discipline`` is the authority on which codes exist; a code
    nobody has written behaviour for simply has none."""
    spec = discipline("chess")
    assert spec.code == "chess"
    assert spec.sides == ()


# ── v1 / legacy actor tokens resolve to slots ───────────────────────────────


def _ruleset(*actors: str) -> pbr.Ruleset:
    return pbr.parse_ruleset(
        {
            "version": 2,
            "timer_seconds": 60,
            "phases": [
                {
                    "id": "main",
                    "when": {},
                    "pool_filter": {},
                    "generator": None,
                    "steps": [
                        {"id": f"s{index}", "action": "ban", "actors": actor, "count": 1, "lifetime": 1}
                        for index, actor in enumerate(actors, start=1)
                    ],
                }
            ],
        }
    )


def test_v1_tokens_resolve_to_the_opener_and_the_seat_after_it():
    steps = pbr.resolve_round(
        _ruleset("first", "second", "both"),
        kind="hero",
        round=1,
        start_index=0,
        participants=SEATS,
        opener=SLOT2,
        best_of=1,
    )
    assert [step.actors for step in steps] == [[SLOT2], [SLOT1], [SLOT2, SLOT1]]


def test_stored_home_and_away_actors_resolve_to_slots_one_and_two():
    """``enclayer01`` rewrites stored ``ruleset_json`` to ``slot:1``/``slot:2``,
    but a document read before that migration ran must mean the same thing."""
    steps = pbr.resolve_round(
        _ruleset("home", "away", "slot:1", "slot:2"),
        kind="hero",
        round=1,
        start_index=0,
        participants=SEATS,
        # The opener is slot 2 on purpose: a slot token names a SEAT, so it must
        # not follow whoever happens to open the round.
        opener=SLOT2,
        best_of=1,
    )
    assert [step.actors for step in steps] == [[SLOT1], [SLOT2], [SLOT1], [SLOT2]]


def test_a_stored_resolved_sequence_still_naming_sides_is_translated():
    """``enclayer01`` did NOT rewrite ``resolved_sequence_json``, so a room that
    was mid-veto when it ran still holds ``sides: ["home"]``."""
    (step,) = pbr.resolve_round(
        _ruleset("first"), kind="hero", round=1, start_index=0, participants=SEATS, opener=SLOT1, best_of=1
    )
    legacy = {key: value for key, value in step.to_json().items() if key != "actors"}
    legacy["sides"] = ["home", "system"]

    (translated,) = pbr.resolved_steps_from_json([legacy], actors_by_slot={1: SLOT1, 2: SLOT2})
    assert translated.actors == [SLOT1, None]
    assert translated.acting_actors == [SLOT1]


def test_a_legacy_sequence_whose_slot_is_vacant_is_an_error_not_a_system_step():
    legacy = {
        "index": 0,
        "round": 1,
        "phase_id": "main",
        "step_id": "s1",
        "action": "ban",
        "sides": ["away"],
        "count": 1,
        "min": 1,
        "blind": False,
        "target": None,
        "lifetime": 1,
        "timer_seconds": None,
        "on_timeout": "random_fill",
        "dispute": {"enabled": False, "max": 0},
        "eligible": {},
        "constraints": [],
    }
    with pytest.raises(ValueError, match="no participation covers"):
        pbr.resolved_steps_from_json([legacy], actors_by_slot={1: SLOT1})


# ── side_pick and side:<code> ───────────────────────────────────────────────


def _side_ruleset(*steps: dict) -> dict:
    return {
        "version": 2,
        "timer_seconds": 60,
        "phases": [{"id": "main", "when": {}, "pool_filter": {}, "generator": None, "steps": list(steps)}],
    }


_SIDE_PICK = {"id": "sp", "action": "side_pick", "actors": "first", "count": 1}
_PICK = {"id": "p1", "action": "pick", "actors": "second", "count": 1}


def test_side_pick_is_rejected_for_a_discipline_without_sides():
    issues = pbr.validate_ruleset(_side_ruleset(_SIDE_PICK, _PICK), kind="map", discipline="overwatch", slot_count=2)
    codes = {issue.code for issue in issues if issue.severity == "error"}
    assert "side_pick_unsupported" in codes


def test_side_pick_is_accepted_when_the_discipline_declares_one_side_per_seat(sided_discipline):
    issues = pbr.validate_ruleset(_side_ruleset(_SIDE_PICK, _PICK), kind="map", discipline=SIDED.code, slot_count=2)
    assert [issue.to_json() for issue in issues if issue.severity == "error"] == []


def test_side_pick_is_rejected_when_the_card_seats_more_than_the_game_has_sides(sided_discipline):
    issues = pbr.validate_ruleset(_side_ruleset(_SIDE_PICK, _PICK), kind="map", discipline=SIDED.code, slot_count=3)
    assert "side_pick_unsupported" in {issue.code for issue in issues if issue.severity == "error"}


def test_a_side_actor_must_be_assigned_by_an_earlier_side_pick(sided_discipline):
    after = _side_ruleset(_SIDE_PICK, {**_PICK, "actors": "side:attack"})
    assert [
        issue for issue in pbr.validate_ruleset(after, kind="map", discipline=SIDED.code) if issue.severity == "error"
    ] == []

    before = _side_ruleset({**_PICK, "actors": "side:attack"}, _SIDE_PICK)
    codes = {
        issue.code
        for issue in pbr.validate_ruleset(before, kind="map", discipline=SIDED.code)
        if issue.severity == "error"
    }
    assert "actors_side_unassigned" in codes


def test_an_unknown_side_code_is_refused(sided_discipline):
    ruleset = _side_ruleset(_SIDE_PICK, {**_PICK, "actors": "side:zerg"})
    codes = {
        issue.code
        for issue in pbr.validate_ruleset(ruleset, kind="map", discipline=SIDED.code)
        if issue.severity == "error"
    }
    assert "actors_unknown_side" in codes


def test_a_side_actor_resolves_to_the_participation_that_chose_that_side(sided_discipline):
    (step,) = pbr.resolve_round(
        pbr.parse_ruleset(_side_ruleset({**_PICK, "actors": "side:defence"})),
        kind="map",
        round=1,
        start_index=0,
        participants=SEATS,
        opener=SLOT1,
        sides={"attack": SLOT1, "defence": SLOT2},
        best_of=1,
    )
    assert step.actors == [SLOT2]


def test_an_actor_naming_an_unseated_slot_is_refused():
    ruleset = _side_ruleset({**_PICK, "actors": "slot:3"})
    codes = {
        issue.code for issue in pbr.validate_ruleset(ruleset, kind="map", slot_count=2) if issue.severity == "error"
    }
    assert "actors_slot_unseated" in codes


def test_a_side_pick_spends_nothing_from_the_pool(sided_discipline):
    """A side is not a board item, so a round that spends its whole pool on
    picks is still playable with a side pick in front of it."""
    steps = pbr.resolve_round(
        pbr.parse_ruleset(_side_ruleset(_SIDE_PICK, _PICK)),
        kind="map",
        round=1,
        start_index=0,
        participants=SEATS,
        opener=SLOT1,
        sides={"attack": SLOT1, "defence": SLOT2},
        best_of=1,
    )
    assert [step.action for step in steps] == ["side_pick", "pick"]
    assert [step.count for step in steps] == [1, 1]
