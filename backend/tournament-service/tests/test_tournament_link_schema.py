"""Write schemas type ``kind`` and ``url``; they must not accept XSS hrefs."""

from __future__ import annotations

import os
import sys
from pathlib import Path

import pytest
from pydantic import ValidationError

backend_root = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(backend_root))
sys.path.insert(0, str(backend_root / "tournament-service"))

os.environ.setdefault("DEBUG", "true")

from src import schemas  # noqa: E402


def _create(**overrides: object) -> schemas.TournamentLinkCreate:
    payload: dict[str, object] = {
        "tournament_id": 1,
        "kind": "stream",
        "url": "https://twitch.tv/anak",
    }
    payload.update(overrides)
    return schemas.TournamentLinkCreate.model_validate(payload)


def test_create_accepts_http_url_and_dumps_a_string() -> None:
    dumped = _create().model_dump(mode="json")
    assert dumped["kind"] == "stream"
    assert dumped["url"] == "https://twitch.tv/anak"


def test_create_rejects_unknown_kind() -> None:
    with pytest.raises(ValidationError, match="kind"):
        _create(kind="twitter")


def test_create_rejects_javascript_url() -> None:
    with pytest.raises(ValidationError, match="url"):
        _create(url="javascript:alert(1)")


def test_update_unset_url_stays_out_of_dump() -> None:
    updated = schemas.TournamentLinkUpdate.model_validate({"is_active": False})
    assert updated.model_dump(mode="json", exclude_unset=True) == {"is_active": False}
