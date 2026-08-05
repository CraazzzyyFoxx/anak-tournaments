import pytest

from shared.domain.roster_shape import (
    DEFAULT_ROSTER_SLOTS,
    FLEX_SLOT_CODE,
    ROSTER_SLOT_CODES,
    RosterShapeError,
    parse_roster_slots,
)


def test_slot_codes_are_registration_roles_plus_flex() -> None:
    assert ROSTER_SLOT_CODES == ("tank", "dps", "support", "flex")
    assert FLEX_SLOT_CODE == "flex"
    assert DEFAULT_ROSTER_SLOTS == {"tank": 1, "dps": 2, "support": 2}


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


def test_single_slot_roster_still_drafts_one_round() -> None:
    # team_size 1 means the captain fills the only slot; rounds must stay >= 1.
    assert parse_roster_slots({"flex": 1}).draft_rounds == 1


def test_to_dict_returns_a_detached_mutable_copy() -> None:
    shape = parse_roster_slots({"flex": 6})
    dumped = shape.to_dict()
    dumped["tank"] = 1

    assert shape.slots == {"flex": 6}


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
        ({"flex": 13}, "roster_slots_out_of_range"),
        ({"tank": 6, "dps": 7}, "roster_slots_out_of_range"),
    ],
)
def test_rejects_invalid_maps_with_machine_readable_codes(raw: object, code: str) -> None:
    with pytest.raises(RosterShapeError) as exc_info:
        parse_roster_slots(raw)

    assert exc_info.value.code == code


def test_error_is_a_value_error_so_pydantic_validators_can_catch_it() -> None:
    assert issubclass(RosterShapeError, ValueError)


def test_shape_is_frozen_and_hashable() -> None:
    shape = parse_roster_slots({"flex": 6})

    with pytest.raises(Exception):
        shape.slots = {"tank": 1}  # type: ignore[misc]
    assert hash(shape) == hash(parse_roster_slots({"flex": 6}))
