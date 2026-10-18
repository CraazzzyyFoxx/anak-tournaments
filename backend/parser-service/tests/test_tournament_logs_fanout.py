"""Bulk delivery fans native job IDs out; real enumeration lives in test_stats_ingest_db."""

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

from tests._fakes import session_factory

serve = importlib.import_module("serve")


class TournamentLogsFanoutTests(IsolatedAsyncioTestCase):
    async def test_every_native_job_gets_a_message_without_inline_parsing(self):
        publish = AsyncMock()
        session = SimpleNamespace()
        with (
            patch.object(serve.db, "async_session_maker", session_factory(session)),
            patch.object(
                serve.log_records_service, "requeue_tournament", AsyncMock(return_value=[501, 502])
            ) as requeue,
            patch.object(serve, "publish_message", publish),
            patch.object(serve, "process_ingest_job", AsyncMock()) as parse,
        ):
            await serve.process_tournament_log(
                {"tournament_id": 42}, SimpleNamespace(headers={}, message_id=None, raw_message=None)
            )
        requeue.assert_awaited_once_with(session, 42)
        parse.assert_not_awaited()
        self.assertEqual([501, 502], [call.args[1]["ingest_job_id"] for call in publish.await_args_list])
        self.assertTrue(
            all(
                "filename" not in call.args[1] and "tournament_id" not in call.args[1]
                for call in publish.await_args_list
            )
        )

    async def test_unknown_tournament_publishes_nothing(self):
        publish = AsyncMock()
        with (
            patch.object(serve.db, "async_session_maker", session_factory(SimpleNamespace())),
            patch.object(
                serve.log_records_service, "requeue_tournament", AsyncMock(side_effect=RuntimeError("not found"))
            ),
            patch.object(serve, "publish_message", publish),
            self.assertRaises(RuntimeError),
        ):
            await serve.process_tournament_log(
                {"tournament_id": 42}, SimpleNamespace(headers={}, message_id=None, raw_message=None)
            )
        publish.assert_not_awaited()

    async def test_tournament_without_jobs_publishes_nothing(self):
        publish = AsyncMock()
        with (
            patch.object(serve.db, "async_session_maker", session_factory(SimpleNamespace())),
            patch.object(serve.log_records_service, "requeue_tournament", AsyncMock(return_value=[])),
            patch.object(serve, "publish_message", publish),
        ):
            await serve.process_tournament_log(
                {"tournament_id": 42}, SimpleNamespace(headers={}, message_id=None, raw_message=None)
            )
        publish.assert_not_awaited()
