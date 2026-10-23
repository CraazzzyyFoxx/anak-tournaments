import copy
import dataclasses
import json
import pickle

import pytest

from shared.domain.roster_shape import FLEX_SLOT_CODE, MAX_TEAM_SIZE, MIN_TEAM_SIZE, RosterShape, RosterShapeError

ROLE_QUEUE = RosterShape(entries=(("tank", 1), ("damage", 2), ("support", 2)))
HYBRID = RosterShape(entries=(("tank", 1), ("flex", 5)))
OPEN = RosterShape(entries=(("flex", 6),))


def test_the_open_slot_key_and_the_team_size_bounds_are_pinned() -> None:
    assert FLEX_SLOT_CODE == "flex"
    assert (MIN_TEAM_SIZE, MAX_TEAM_SIZE) == (1, 12)


def test_a_role_queue_shape() -> None:
    assert ROLE_QUEUE.slots == {"tank": 1, "damage": 2, "support": 2}
    assert (ROLE_QUEUE.team_size, ROLE_QUEUE.flex_slots, ROLE_QUEUE.has_role_slots, ROLE_QUEUE.draft_rounds) == (
        5,
        0,
        True,
        4,
    )
    assert ROLE_QUEUE.role_slots == {"tank": 1, "damage": 2, "support": 2}


def test_a_role_less_shape() -> None:
    assert (OPEN.team_size, OPEN.flex_slots, OPEN.role_slots, OPEN.has_role_slots, OPEN.draft_rounds) == (
        6,
        6,
        {},
        False,
        5,
    )


def test_a_hybrid_shape() -> None:
    assert (HYBRID.team_size, HYBRID.flex_slots, HYBRID.role_slots, HYBRID.has_role_slots) == (6, 5, {"tank": 1}, True)


def test_any_role_code_of_a_discipline_is_a_slot_code() -> None:
    positions = RosterShape(entries=(("top", 1), ("jungle", 1), ("mid", 1), ("bot", 1), ("support", 1)))
    assert positions.team_size == 5
    assert positions.has_role_slots is True


def test_the_largest_and_the_smallest_roster() -> None:
    assert RosterShape(entries=(("flex", MAX_TEAM_SIZE),)).draft_rounds == MAX_TEAM_SIZE - 1
    assert RosterShape(entries=(("flex", MIN_TEAM_SIZE),)).draft_rounds == 0


def test_slots_returns_a_detached_mutable_copy() -> None:
    dumped = OPEN.slots
    dumped["tank"] = 1
    assert OPEN.slots == {"flex": 6}


def test_role_slots_returns_a_detached_mutable_copy() -> None:
    dumped = HYBRID.role_slots
    dumped["damage"] = 4
    assert HYBRID.role_slots == {"tank": 1}


@pytest.mark.parametrize(
    ("entries", "code"),
    [
        ((), "roster_slots_empty"),
        ((("", 2), ("flex", 2)), "roster_slots_unknown_code"),
        ((("tank", 0), ("flex", 5)), "roster_slots_invalid_count"),
        ((("tank", True), ("flex", 5)), "roster_slots_invalid_count"),
        ((("tank", "1"), ("flex", 5)), "roster_slots_invalid_count"),
        ((("flex", 1), ("tank", 1)), "roster_slots_not_canonical"),
        ((("tank", 1), ("tank", 1)), "roster_slots_not_canonical"),
        ([("tank", 1), ("flex", 1)], "roster_slots_not_canonical"),
        ((("flex", MAX_TEAM_SIZE + 1),), "roster_slots_out_of_range"),
    ],
)
def test_direct_construction_enforces_the_invariants(entries: object, code: str) -> None:
    with pytest.raises(RosterShapeError) as exc_info:
        RosterShape(entries=entries)  # type: ignore[arg-type]
    assert exc_info.value.code == code


def test_error_is_a_value_error_so_pydantic_validators_can_catch_it() -> None:
    assert issubclass(RosterShapeError, ValueError)


def test_shape_is_frozen_and_hashable() -> None:
    with pytest.raises(dataclasses.FrozenInstanceError):
        OPEN.entries = (("tank", 1),)  # type: ignore[misc]
    assert hash(OPEN) == hash(RosterShape(entries=(("flex", 6),)))


def test_shape_survives_the_serialization_paths_it_travels_through() -> None:
    assert json.loads(json.dumps(HYBRID.slots)) == {"tank": 1, "flex": 5}
    assert copy.deepcopy(HYBRID) == HYBRID
    assert pickle.loads(pickle.dumps(HYBRID)) == HYBRID
    assert dataclasses.asdict(HYBRID) == {"entries": (("tank", 1), ("flex", 5))}
