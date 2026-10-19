from __future__ import annotations

import sys
from pathlib import Path

import pytest

REPO_BACKEND_ROOT = Path(__file__).resolve().parents[2]
BALANCER_SERVICE_ROOT = REPO_BACKEND_ROOT / "balancer-service"

for candidate in (str(REPO_BACKEND_ROOT), str(BALANCER_SERVICE_ROOT)):
    if candidate not in sys.path:
        sys.path.insert(0, candidate)


from pydantic import ValidationError  # noqa: E402

from src.schemas.custom_game import CustomGameCreate  # noqa: E402


def test_a_mix_create_request_must_name_its_game() -> None:
    # No game is implied: a body without `discipline` used to open an Overwatch mix.
    with pytest.raises(ValidationError) as excinfo:
        CustomGameCreate.model_validate({"name": "Friday mix"})
    assert [error["loc"] for error in excinfo.value.errors()] == [("discipline",)]


def test_a_mix_create_request_carries_the_requested_game() -> None:
    body = CustomGameCreate.model_validate({"name": "Friday mix", "discipline": "lol"})
    assert body.discipline == "lol"
