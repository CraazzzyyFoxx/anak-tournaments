from __future__ import annotations

import os
import sys
from pathlib import Path
from types import SimpleNamespace
from unittest import IsolatedAsyncioTestCase
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from pydantic import ValidationError

REPO_BACKEND_ROOT = Path(__file__).resolve().parents[2]
BALANCER_SERVICE_ROOT = REPO_BACKEND_ROOT / "balancer-service"

for candidate in (str(REPO_BACKEND_ROOT), str(BALANCER_SERVICE_ROOT)):
    if candidate not in sys.path:
        sys.path.insert(0, candidate)

os.environ.setdefault("PROJECT_URL", "http://localhost")
os.environ.setdefault("REDIS_URL", "redis://localhost:6379/0")
os.environ.setdefault("POSTGRES_USER", "postgres")
os.environ.setdefault("POSTGRES_PASSWORD", "postgres")
os.environ.setdefault("POSTGRES_DB", "postgres")
os.environ.setdefault("POSTGRES_HOST", "localhost")
os.environ.setdefault("POSTGRES_PORT", "5432")
os.environ.setdefault("CHALLONGE_USERNAME", "test")
os.environ.setdefault("CHALLONGE_API_KEY", "test")
os.environ.setdefault("S3_ACCESS_KEY", "test")
os.environ.setdefault("S3_SECRET_KEY", "test")
os.environ.setdefault("S3_ENDPOINT_URL", "http://localhost")
os.environ.setdefault("S3_BUCKET_NAME", "test")
os.environ["DEBUG"] = "false"

from src.service import (  # noqa: E402
    EDITABLE_CONFIG_FIELD_KEYS,
    get_balancer_config_payload,
    normalize_tournament_config_payload,
)
from src.services.admin import balancer as balancer_admin_service  # noqa: E402


def test_config_payload_exposes_complete_editable_field_metadata() -> None:
    payload = get_balancer_config_payload()

    fields = payload["fields"]
    field_keys = {field["key"] for field in fields}

    assert field_keys == EDITABLE_CONFIG_FIELD_KEYS
    assert {"workspace_id", "tournament_id", "division_grid", "MIXTURA_QUEUE"}.isdisjoint(field_keys)

    fields_by_key = {field["key"]: field for field in fields}
    assert fields_by_key["POPULATION_SIZE"]["limits"] == {"min": 10, "max": 1000}
    assert fields_by_key["MAX_CPSAT_SOLUTIONS"]["limits"] == {"min": 1, "max": 5}
    assert fields_by_key["MAX_NSGA_SOLUTIONS"]["limits"] == {"min": 1, "max": 200}
    assert fields_by_key["MAX_GENETIC_SOLUTIONS"]["limits"] == {"min": 1, "max": 50}
    assert fields_by_key["STAGNATION_THRESHOLD"]["limits"] == {"min": 1, "max": 500}
    assert fields_by_key["SUBROLE_COLLISION_WEIGHT"]["limits"] == {"min": 0.0, "max": 10000.0}
    assert fields_by_key["ALGORITHM"]["options"] == ["genetic", "genetic_moo", "cpsat", "nsga"]
    assert fields_by_key["MASK"]["type"] == "role_mask"
    assert fields_by_key["ROLE_MAPPING"]["type"] == "string_map"

    for field in fields:
        assert field["label"]
        assert field["description"]
        assert field["group"] in {"Roles", "Algorithm", "Quality weights", "Strategy", "Solver output"}
        assert field["default"] == payload["defaults"].get(field["key"])
        assert field["applies_to"]


def test_normalize_tournament_config_payload_keeps_only_valid_editable_fields() -> None:
    normalized = normalize_tournament_config_payload(
        {
            "POPULATION_SIZE": 150,
            "USE_CAPTAINS": None,
            "MASK": {"Tank": 1, "Damage": 2, "Support": 2},
            "workspace_id": 7,
            "MIXTURA_QUEUE": "private.queue",
        }
    )

    assert normalized == {
        "POPULATION_SIZE": 150,
        "MASK": {"Tank": 1, "Damage": 2, "Support": 2},
    }


def test_normalize_tournament_config_payload_rejects_invalid_values() -> None:
    with pytest.raises(ValidationError):
        normalize_tournament_config_payload({"POPULATION_SIZE": 1})


class TournamentConfigPersistenceTests(IsolatedAsyncioTestCase):
    async def test_upsert_tournament_config_creates_normalized_row(self) -> None:
        session = AsyncMock()
        session.add = MagicMock()
        user = SimpleNamespace(id=42)

        with (
            patch.object(balancer_admin_service, "get_tournament_workspace_id", AsyncMock(return_value=9)),
            patch.object(balancer_admin_service, "get_tournament_config", AsyncMock(return_value=None)),
        ):
            result = await balancer_admin_service.upsert_tournament_config(
                session,
                77,
                {"POPULATION_SIZE": 150, "USE_CAPTAINS": None, "workspace_id": 9},
                user,
            )

        self.assertEqual(result.tournament_id, 77)
        self.assertEqual(result.workspace_id, 9)
        self.assertEqual(result.config_json, {"POPULATION_SIZE": 150})
        self.assertEqual(result.updated_by, 42)
        session.add.assert_called_once_with(result)
        session.commit.assert_awaited_once()

    async def test_upsert_tournament_config_updates_existing_row(self) -> None:
        session = AsyncMock()
        session.add = MagicMock()
        user = SimpleNamespace(id=43)
        existing = SimpleNamespace(
            tournament_id=77,
            workspace_id=9,
            config_json={"POPULATION_SIZE": 150},
            updated_by=42,
            updated_at=None,
        )

        with (
            patch.object(balancer_admin_service, "get_tournament_workspace_id", AsyncMock(return_value=9)),
            patch.object(balancer_admin_service, "get_tournament_config", AsyncMock(return_value=existing)),
        ):
            result = await balancer_admin_service.upsert_tournament_config(
                session,
                77,
                {"ALGORITHM": "nsga", "MAX_NSGA_SOLUTIONS": 6},
                user,
            )

        self.assertIs(result, existing)
        self.assertEqual(existing.config_json, {"ALGORITHM": "nsga", "MAX_NSGA_SOLUTIONS": 6})
        self.assertEqual(existing.updated_by, 43)
        session.add.assert_not_called()
        session.commit.assert_awaited_once()
