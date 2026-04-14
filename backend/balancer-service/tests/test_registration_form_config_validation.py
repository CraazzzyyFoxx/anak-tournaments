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

from src.schemas.admin.registration_form import RegistrationFormUpsert


def test_registration_form_upsert_rejects_invalid_regex_pattern() -> None:
    with pytest.raises(ValidationError):
        RegistrationFormUpsert(
            is_open=True,
            built_in_fields={
                "battle_tag": {
                    "enabled": True,
                    "required": True,
                    "validation": {
                        "regex": "(",
                        "error_message": "Broken pattern",
                    },
                }
            },
        )


def test_registration_form_upsert_accepts_validation_rules_for_built_in_and_custom_fields() -> None:
    payload = RegistrationFormUpsert(
        is_open=True,
        built_in_fields={
            "battle_tag": {
                "enabled": True,
                "required": True,
                "validation": {
                    "regex": r"([\w0-9]{2,12}#[0-9]{4,})",
                    "error_message": "BattleTag must look like Player#1234",
                },
            }
        },
        custom_fields=[
            {
                "key": "boosty",
                "label": "Boosty",
                "type": "text",
                "required": False,
                "validation": {
                    "regex": r"[a-z0-9_]{3,}",
                    "error_message": "Boosty nick is invalid",
                },
            }
        ],
    )

    assert payload.built_in_fields["battle_tag"].validation is not None
    assert payload.built_in_fields["battle_tag"].validation.regex == r"([\w0-9]{2,12}#[0-9]{4,})"
    assert payload.custom_fields[0].validation is not None
    assert payload.custom_fields[0].validation.regex == r"[a-z0-9_]{3,}"
