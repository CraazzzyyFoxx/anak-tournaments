from __future__ import annotations

from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from src.schemas.registration import RegistrationCreate
from src.services.registration.validation import validate_registration_input


def _form(*, built_in_fields: dict | None = None, custom_fields: list[dict] | None = None) -> SimpleNamespace:
    return SimpleNamespace(
        built_in_fields_json=built_in_fields or {},
        custom_fields_json=custom_fields or [],
    )


def test_validate_registration_input_accepts_normalized_battle_tag() -> None:
    form = _form(
        built_in_fields={
            "battle_tag": {
                "enabled": True,
                "required": True,
                "validation": {
                    "regex": r"([\w0-9]{2,12}#[0-9]{4,})",
                    "error_message": "BattleTag must look like Player#1234",
                },
            }
        }
    )
    payload = RegistrationCreate(battle_tag="Player #1234")

    validate_registration_input(form, payload)


def test_validate_registration_input_rejects_invalid_battle_tag_with_custom_message() -> None:
    form = _form(
        built_in_fields={
            "battle_tag": {
                "enabled": True,
                "required": True,
                "validation": {
                    "regex": r"([\w0-9]{2,12}#[0-9]{4,})",
                    "error_message": "BattleTag must look like Player#1234",
                },
            }
        }
    )
    payload = RegistrationCreate(battle_tag="not-a-tag")

    with pytest.raises(HTTPException) as exc_info:
        validate_registration_input(form, payload)

    assert exc_info.value.status_code == 422
    assert exc_info.value.detail == "BattleTag must look like Player#1234"


def test_validate_registration_input_rejects_custom_field_pattern_mismatch() -> None:
    form = _form(
        custom_fields=[
            {
                "key": "boosty",
                "label": "Boosty",
                "type": "text",
                "required": False,
                "validation": {
                    "regex": r"[a-z0-9_]{3,}",
                    "error_message": "Boosty nick can contain only lowercase latin letters, digits, and underscores.",
                },
            }
        ]
    )
    payload = RegistrationCreate(custom_fields={"boosty": "Bad Nick!"})

    with pytest.raises(HTTPException) as exc_info:
        validate_registration_input(form, payload)

    assert exc_info.value.status_code == 422
    assert exc_info.value.detail == "Boosty nick can contain only lowercase latin letters, digits, and underscores."


def test_validate_registration_input_accepts_required_stream_pov_when_false() -> None:
    form = _form(
        built_in_fields={
            "stream_pov": {
                "enabled": True,
                "required": True,
            }
        }
    )
    payload = RegistrationCreate(stream_pov=False)

    validate_registration_input(form, payload)


def test_validate_registration_input_accepts_required_checkbox_custom_field_when_false() -> None:
    form = _form(
        custom_fields=[
            {
                "key": "vod_review",
                "label": "VOD review",
                "type": "checkbox",
                "required": True,
            }
        ]
    )
    payload = RegistrationCreate(custom_fields={"vod_review": "false"})

    validate_registration_input(form, payload)
