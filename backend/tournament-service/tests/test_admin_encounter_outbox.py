from __future__ import annotations

import importlib
import os
import sys
from pathlib import Path
from types import SimpleNamespace
from unittest import IsolatedAsyncioTestCase
from unittest.mock import AsyncMock, Mock, patch

backend_root = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(backend_root))
sys.path.insert(0, str(backend_root / "tournament-service"))

os.environ["DEBUG"] = "true"
os.environ.setdefault("PROJECT_URL", "http://localhost")
os.environ.setdefault("RABBITMQ_URL", "amqp://guest:guest@localhost:5672")
os.environ.setdefault("REDIS_URL", "redis://localhost:6379/0")
os.environ.setdefault("POSTGRES_USER", "postgres")
os.environ.setdefault("POSTGRES_PASSWORD", "postgres")
os.environ.setdefault("POSTGRES_DB", "postgres")
os.environ.setdefault("POSTGRES_HOST", "localhost")
os.environ.setdefault("POSTGRES_PORT", "5432")
os.environ.setdefault("CHALLONGE_USERNAME", "test")
os.environ.setdefault("CHALLONGE_API_KEY", "test")

admin_encounter_service = importlib.import_module("src.services.admin.encounter")
admin_encounter_schema = importlib.import_module("src.schemas.admin.encounter")


def _result(value):
    result = Mock()
    result.scalar_one_or_none.return_value = value
    return result


def _scalars_result(values):
    scalars = Mock()
    scalars.all.return_value = values
    result = Mock()
    result.scalars.return_value = scalars
    return result


class AdminEncounterOutboxTests(IsolatedAsyncioTestCase):
    async def test_create_encounter_enqueues_recalc_before_commit(self) -> None:
        calls: list[str] = []
        execute_count = 0

        async def fake_execute(_query):
            nonlocal execute_count
            execute_count += 1
            if execute_count == 1:
                calls.append("loaded_tournament")
                return _result(SimpleNamespace(id=1))
            if execute_count == 2:
                calls.append("loaded_stage")
                return _result(SimpleNamespace(id=10))
            calls.append("loaded_groups")
            return _scalars_result([])

        async def fake_commit():
            calls.append("commit")

        async def fake_enqueue(_session, tournament_id):
            calls.append(f"enqueue:{tournament_id}")

        session = SimpleNamespace(
            execute=AsyncMock(side_effect=fake_execute),
            add=Mock(),
            commit=AsyncMock(side_effect=fake_commit),
            refresh=AsyncMock(),
        )
        payload = admin_encounter_schema.EncounterCreate(
            name="Round 1",
            tournament_id=1,
            stage_id=10,
            round=1,
        )

        with patch.object(
            admin_encounter_service,
            "enqueue_tournament_recalculation",
            AsyncMock(side_effect=fake_enqueue),
        ) as enqueue_recalc:
            encounter = await admin_encounter_service.create_encounter(session, payload)

        self.assertEqual(encounter.tournament_id, 1)
        enqueue_recalc.assert_awaited_once_with(session, 1)
        self.assertLess(calls.index("enqueue:1"), calls.index("commit"))
