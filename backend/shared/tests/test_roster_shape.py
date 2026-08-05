import copy
import dataclasses
import json
import pickle

import pytest

from shared.domain.player_sub_roles import REGISTRATION_ROLE_CODES
from shared.domain.roster_shape import (
    DEFAULT_ROSTER_SHAPE,
    DEFAULT_ROSTER_SLOTS,
    FLEX_SLOT_CODE,
    MAX_TEAM_SIZE,
    MIN_TEAM_SIZE,
    ROSTER_SLOT_CODES,
    RosterShape,
    RosterShapeError,
    parse_roster_slots,
)


def test_slot_codes_are_derived_from_registration_roles() -> None:
    # Asserting the relationship, not the literal: replacing the unpacking with a
    # hardcoded tuple would add a fifth copy of the role vocabulary to the repo,
    # which is exactly the duplication this feature removes.
    assert ROSTER_SLOT_CODES == (*REGISTRATION_ROLE_CODES, FLEX_SLOT_CODE)
    assert FLEX_SLOT_CODE not in REGISTRATION_ROLE_CODES


def test_slot_codes_and_defaults_have_the_expected_membership() -> None:
    assert ROSTER_SLOT_CODES == ("tank", "dps", "support", "flex")
    assert FLEX_SLOT_CODE == "flex"
    assert DEFAULT_ROSTER_SLOTS == {"tank": 1, "dps": 2, "support": 2}


def test_team_size_bounds_are_pinned() -> None:
    assert MIN_TEAM_SIZE == 2
    assert MAX_TEAM_SIZE == 12


def test_default_roster_slots_cannot_be_mutated() -> None:
    with pytest.raises(TypeError):
        DEFAULT_ROSTER_SLOTS["flex"] = 99  # type: ignore[index]


def test_default_shape_is_the_parsed_default_slots() -> None:
    assert DEFAULT_ROSTER_SHAPE == parse_roster_slots(DEFAULT_ROSTER_SLOTS)
    assert DEFAULT_ROSTER_SHAPE.slots == {"tank": 1, "dps": 2, "support": 2}
    assert DEFAULT_ROSTER_SHAPE.team_size == 5


def test_parses_overwatch_five_v_five() -> None:
    shape = parse_roster_slots({"tank": 1, "dps": 2, "support": 2})

    assert shape.slots == {"tank": 1, "dps": 2, "support": 2}
    assert shape.team_size == 5
    assert shape.flex_slots == 0
    assert shape.role_slots == {"tank": 1, "dps": 2, "support": 2}
    assert shape.has_role_slots is True
    assert shape.draft_rounds == 4


def test_parses_role_less_roster() -> None:
    shape = parse_roster_slots({"flex": 6})

    assert shape.team_size == 6
    assert shape.flex_slots == 6
    assert shape.role_slots == {}
    assert shape.has_role_slots is False
    assert shape.draft_rounds == 5


def test_parses_hybrid_roster() -> None:
    shape = parse_roster_slots({"tank": 1, "flex": 5})

    assert shape.team_size == 6
    assert shape.flex_slots == 5
    assert shape.role_slots == {"tank": 1}
    assert shape.has_role_slots is True


def test_drops_zero_counts_so_has_role_slots_is_unambiguous() -> None:
    shape = parse_roster_slots({"tank": 0, "dps": 0, "support": 0, "flex": 6})

    assert shape.slots == {"flex": 6}
    assert shape.has_role_slots is False


def test_normalizes_key_order_to_canonical() -> None:
    shape = parse_roster_slots({"flex": 1, "support": 2, "tank": 1})

    assert list(shape.slots) == ["tank", "support", "flex"]
    assert shape.entries == (("tank", 1), ("support", 2), ("flex", 1))


def test_accepts_the_largest_allowed_roster() -> None:
    shape = parse_roster_slots({"flex": MAX_TEAM_SIZE})

    assert shape.team_size == MAX_TEAM_SIZE
    assert shape.draft_rounds == MAX_TEAM_SIZE - 1


def test_accepts_the_smallest_allowed_roster() -> None:
    assert parse_roster_slots({"tank": 1, "flex": 1}).draft_rounds == 1


def test_rejects_single_slot_roster_because_there_is_nothing_to_draft() -> None:
    # The captain fills the only slot, so a one-slot roster has zero picks and no
    # balancing to do; it is not a valid shape rather than a shape drafting once.
    with pytest.raises(RosterShapeError) as exc_info:
        parse_roster_slots({"flex": 1})

    assert exc_info.value.code == "roster_slots_out_of_range"


def test_slots_returns_a_detached_mutable_copy() -> None:
    shape = parse_roster_slots({"flex": 6})
    dumped = shape.slots
    dumped["tank"] = 1

    assert shape.slots == {"flex": 6}
    assert shape.has_role_slots is False


def test_role_slots_returns_a_detached_mutable_copy() -> None:
    shape = parse_roster_slots({"tank": 1, "flex": 5})
    dumped = shape.role_slots
    dumped["dps"] = 4

    assert shape.role_slots == {"tank": 1}


@pytest.mark.parametrize(
    ("raw", "code"),
    [
        (None, "roster_slots_not_a_map"),
        ([("tank", 1)], "roster_slots_not_a_map"),
        ({"healer": 2}, "roster_slots_unknown_code"),
        ({"Tank": 1}, "roster_slots_unknown_code"),
        ({"tank": -1}, "roster_slots_invalid_count"),
        ({"tank": 1.5}, "roster_slots_invalid_count"),
        ({"tank": True}, "roster_slots_invalid_count"),
        ({"tank": "1"}, "roster_slots_invalid_count"),
        ({}, "roster_slots_empty"),
        ({"tank": 0}, "roster_slots_empty"),
        ({"flex": MAX_TEAM_SIZE + 1}, "roster_slots_out_of_range"),
        # Over the limit by sum rather than by any single slot.
        ({"tank": 1, "dps": MAX_TEAM_SIZE}, "roster_slots_out_of_range"),
        ({"flex": MIN_TEAM_SIZE - 1}, "roster_slots_out_of_range"),
    ],
)
def test_rejects_invalid_maps_with_machine_readable_codes(raw: object, code: str) -> None:
    with pytest.raises(RosterShapeError) as exc_info:
        parse_roster_slots(raw)

    assert exc_info.value.code == code


@pytest.mark.parametrize(
    ("entries", "code"),
    [
        ((), "roster_slots_empty"),
        ((("healer", 2), ("flex", 2)), "roster_slots_unknown_code"),
        ((("tank", 0), ("flex", 5)), "roster_slots_invalid_count"),
        ((("tank", True), ("flex", 5)), "roster_slots_invalid_count"),
        ((("tank", "1"), ("flex", 5)), "roster_slots_invalid_count"),
        ((("flex", 1), ("tank", 1)), "roster_slots_not_canonical"),
        ((("tank", 1), ("tank", 1)), "roster_slots_not_canonical"),
        ([("tank", 1), ("flex", 1)], "roster_slots_not_canonical"),
        ((("flex", MAX_TEAM_SIZE + 1),), "roster_slots_out_of_range"),
        ((("flex", MIN_TEAM_SIZE - 1),), "roster_slots_out_of_range"),
    ],
)
def test_direct_construction_enforces_the_same_invariants(entries: object, code: str) -> None:
    with pytest.raises(RosterShapeError) as exc_info:
        RosterShape(entries=entries)  # type: ignore[arg-type]

    assert exc_info.value.code == code


def test_error_is_a_value_error_so_pydantic_validators_can_catch_it() -> None:
    assert issubclass(RosterShapeError, ValueError)


def test_shape_is_frozen_and_hashable() -> None:
    shape = parse_roster_slots({"flex": 6})

    with pytest.raises(dataclasses.FrozenInstanceError):
        shape.entries = (("tank", 1),)  # type: ignore[misc]
    assert hash(shape) == hash(parse_roster_slots({"flex": 6}))
    assert shape == parse_roster_slots({"flex": 6})


def test_shape_survives_the_serialization_paths_it_travels_through() -> None:
    # A MappingProxyType field passed pyright but blew up at runtime on every one
    # of these; the shape goes through Pydantic into a JSONB column.
    shape = parse_roster_slots({"tank": 1, "flex": 5})

    assert json.loads(json.dumps(shape.slots)) == {"tank": 1, "flex": 5}
    assert json.loads(json.dumps(shape.role_slots)) == {"tank": 1}
    assert copy.deepcopy(shape) == shape
    assert pickle.loads(pickle.dumps(shape)) == shape
    assert dataclasses.asdict(shape) == {"entries": (("tank", 1), ("flex", 5))}
    assert hash(shape) == hash(parse_roster_slots({"tank": 1, "flex": 5}))
