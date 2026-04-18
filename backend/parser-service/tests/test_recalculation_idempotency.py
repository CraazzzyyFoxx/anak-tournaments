from __future__ import annotations

import importlib
import os
import sys
from pathlib import Path
from types import SimpleNamespace
from unittest import IsolatedAsyncioTestCase
from unittest.mock import AsyncMock, patch

backend_root = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(backend_root))
sys.path.insert(0, str(backend_root / "parser-service"))

os.environ["DEBUG"] = "true"
os.environ.setdefault("PROJECT_URL", "http://localhost")
os.environ.setdefault("REDIS_URL", "redis://localhost:6379/0")
os.environ.setdefault("RABBITMQ_URL", "amqp://guest:guest@localhost:5672")
os.environ.setdefault("POSTGRES_USER", "postgres")
os.environ.setdefault("POSTGRES_PASSWORD", "postgres")
os.environ.setdefault("POSTGRES_DB", "postgres")
os.environ.setdefault("POSTGRES_HOST", "localhost")
os.environ.setdefault("POSTGRES_PORT", "5432")

recalculation = importlib.import_module("src.services.standings.recalculation")


class FakeRedis:
    def __init__(self, initial_keys: set[str] | None = None) -> None:
        self.keys = set(initial_keys or set())

    async def set(self, key: str, value: str, *, nx: bool = False, ex: int | None = None) -> bool:
        del value, ex
        if nx and key in self.keys:
            return False
        self.keys.add(key)
        return True

    async def delete(self, key: str) -> int:
        existed = key in self.keys
        self.keys.discard(key)
        return int(existed)


class FakeSessionFactory:
    def __init__(self, session: object) -> None:
        self.session = session

    def __call__(self):
        factory = self

        class Context:
            async def __aenter__(self):
                return factory.session

            async def __aexit__(self, exc_type, exc, tb):
                return False

        return Context()


class RecalculationIdempotencyTests(IsolatedAsyncioTestCase):
    async def test_process_recalculates_publishes_completion_and_clears_pending_marker(self) -> None:
        redis = FakeRedis({"tournament_recalc:pending:42"})
        session = SimpleNamespace()
        recalculate = AsyncMock(return_value=[])
        publish_mock = AsyncMock()

        with patch.object(recalculation, "publish_message", publish_mock):
            processed = await recalculation.process_tournament_recalculation_event(
                {"tournament_id": 42},
                broker=SimpleNamespace(),
                redis=redis,
                session_factory=FakeSessionFactory(session),
                recalculate=recalculate,
            )

        self.assertTrue(processed)
        recalculate.assert_awaited_once_with(session, 42)
        self.assertNotIn("tournament_recalc:pending:42", redis.keys)
        self.assertNotIn("tournament_recalc:processing:42", redis.keys)
        self.assertEqual(1, publish_mock.await_count)
        self.assertEqual("tournament.recalculated.42", publish_mock.await_args.kwargs["routing_key"])

    async def test_process_skips_duplicate_while_processing_lock_exists(self) -> None:
        redis = FakeRedis({"tournament_recalc:pending:42", "tournament_recalc:processing:42"})
        recalculate = AsyncMock()

        with patch.object(recalculation, "publish_message", AsyncMock()) as publish_mock:
            processed = await recalculation.process_tournament_recalculation_event(
                {"tournament_id": 42},
                broker=SimpleNamespace(),
                redis=redis,
                session_factory=FakeSessionFactory(SimpleNamespace()),
                recalculate=recalculate,
            )

        self.assertFalse(processed)
        recalculate.assert_not_awaited()
        publish_mock.assert_not_awaited()
        self.assertIn("tournament_recalc:pending:42", redis.keys)
        self.assertIn("tournament_recalc:processing:42", redis.keys)
