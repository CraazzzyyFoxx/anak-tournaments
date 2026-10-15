from __future__ import annotations

import sys
from pathlib import Path

import pytest
from pydantic import ValidationError

REPO_BACKEND_ROOT = Path(__file__).resolve().parents[2]
BALANCER_SERVICE_ROOT = REPO_BACKEND_ROOT / "balancer-service"
for candidate in (str(REPO_BACKEND_ROOT), str(BALANCER_SERVICE_ROOT)):
    if candidate not in sys.path:
        sys.path.insert(0, candidate)

from shared.core import enums  # noqa: E402
from shared.schemas.role import RoleRef  # noqa: E402


def _schemas():
    try:
        from src.schemas import custom_game
    except ImportError as exc:
        pytest.fail(f"custom-game schemas are missing: {exc}")
    return custom_game


def test_player_patch_accepts_one_participation_enum() -> None:
    patch = _schemas().CustomGamePlayerPatch.model_validate({"participation": "benched"})
    assert patch.participation is enums.MixParticipation.BENCHED
    assert patch.model_fields_set == {"participation"}


def test_player_patch_rejects_legacy_boolean_state() -> None:
    with pytest.raises(ValidationError):
        _schemas().CustomGamePlayerPatch.model_validate({"is_active": False, "must_play": True})


def test_player_patch_does_not_coerce_string_to_boolean() -> None:
    with pytest.raises(ValidationError):
        _schemas().CustomGamePlayerPatch.model_validate({"is_flex": "false"})


def test_roles_preserve_explicit_empty_and_inherited_null() -> None:
    explicit = _schemas().CustomGamePlayerPatch.model_validate({"roles": []})
    inherited = _schemas().CustomGamePlayerPatch.model_validate({"roles": None})
    assert explicit.roles == []
    assert inherited.roles is None
    assert explicit.model_fields_set == inherited.model_fields_set == {"roles"}


def test_bulk_participation_requires_unique_members() -> None:
    with pytest.raises(ValidationError):
        _schemas().CustomGamePlayersParticipationPatch.model_validate(
            {
                "players": [
                    {"workspace_member_id": 7, "participation": "pool"},
                    {"workspace_member_id": 7, "participation": "benched"},
                ]
            }
        )


def test_record_outcome_takes_the_outcome_the_client_sends() -> None:
    """The wire field is ``outcome``, and only 1/2/null are decided outcomes."""
    body = _schemas().CustomGameRecordOutcome.model_validate(
        {"outcome": {"winner": 2}, "variant_index": 0, "map_id": None}
    )
    assert body.outcome.winner == 2


def test_record_outcome_rejects_an_impossible_winner() -> None:
    with pytest.raises(ValidationError):
        _schemas().CustomGameRecordOutcome.model_validate({"outcome": {"winner": 3}, "variant_index": 0})


def test_self_update_distinguishes_an_unset_roles_field_from_a_null_one() -> None:
    """``null`` is "every ranked role"; omitting the key is "don't touch my
    roles". Collapsing the two would silently reset a role order on a flex
    toggle."""
    unset = _schemas().CustomGameSelfUpdate.model_validate({"is_flex": True})
    cleared = _schemas().CustomGameSelfUpdate.model_validate({"roles": None})
    assert unset.model_fields_set == {"is_flex"}
    assert cleared.model_fields_set == {"roles"}
    assert cleared.roles is None


def test_self_update_refuses_the_hosts_own_fields() -> None:
    with pytest.raises(ValidationError):
        _schemas().CustomGameSelfUpdate.model_validate({"participation": "must_play"})


@pytest.mark.parametrize("schema", ["CustomGamePlayerPatch", "CustomGameSelfUpdate"])
def test_mix_patch_validates_role_refs_and_deduplicates_by_dimension_and_role(schema) -> None:
    roles = [RoleRef(dimension="player_role", role=code) for code in ("support", "tank")]
    model = getattr(_schemas(), schema)
    assert model.model_validate({"roles": [*roles, roles[0]]}).roles == roles
    other_dimension = RoleRef(dimension="position", role="support")
    assert model.model_validate({"roles": [roles[0], other_dimension]}).roles == [roles[0], other_dimension]
    with pytest.raises(ValidationError):
        model.model_validate({"roles": ["support"]})


def test_self_service_patch_takes_the_three_signup_modes_and_nothing_else() -> None:
    patch = _schemas().CustomGameSelfServicePatch.model_validate({"self_signup": "benched"})
    assert patch.self_signup is enums.MixSelfSignup.BENCHED
    assert patch.model_fields_set == {"self_signup"}
    with pytest.raises(ValidationError):
        _schemas().CustomGameSelfServicePatch.model_validate({"self_signup": "open"})
    with pytest.raises(ValidationError):
        _schemas().CustomGameSelfServicePatch.model_validate({"self_role_edit": "yes"})


def test_rename_trims_the_name_and_refuses_a_blank_one() -> None:
    assert _schemas().CustomGameRename.model_validate({"name": "  Friday scrim "}).name == "Friday scrim"
    with pytest.raises(ValidationError):
        _schemas().CustomGameRename.model_validate({"name": "   "})
    with pytest.raises(ValidationError):
        _schemas().CustomGameRename.model_validate({"name": "x" * 256})


def test_balance_request_defaults_to_the_first_lobby() -> None:
    """Пустое тело -- ровно то, что слали клиенты до появления лобби."""
    body = _schemas().CustomGameBalanceRequest.model_validate({})
    assert body.scope == "lobby"
    assert body.lobby_index == 0


def test_balance_request_rejects_a_seventh_lobby() -> None:
    assert _schemas().CustomGameBalanceRequest.model_validate({"lobby_index": 5}).lobby_index == 5
    with pytest.raises(ValidationError):
        _schemas().CustomGameBalanceRequest.model_validate({"lobby_index": 6})


def test_balance_request_takes_the_both_lobbies_scope() -> None:
    body = _schemas().CustomGameBalanceRequest.model_validate({"scope": "all"})
    assert body.scope == "all"
    assert body.lobby_index == 0
