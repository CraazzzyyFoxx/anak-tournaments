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
sys.path.insert(0, str(backend_root / "stats-service"))
os.environ["DEBUG"] = "true"

from src.services.match_logs.log_records import TournamentRequeue
from tests._fakes import session_factory

serve = importlib.import_module("serve_worker")


class TournamentLogsFanoutTests(IsolatedAsyncioTestCase):
    async def test_every_native_job_gets_a_message_without_inline_parsing(self):
        publish = AsyncMock()
        session = SimpleNamespace()
        with (
            patch.object(serve.db, "async_session_maker", session_factory(session)),
            patch.object(
                serve.log_records_service,
                "requeue_tournament",
                AsyncMock(return_value=TournamentRequeue(discipline="overwatch", queue=[501, 502], replay={})),
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
        self.assertEqual({"stats.ingest.overwatch"}, {call.args[2].name for call in publish.await_args_list})
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
            patch.object(
                serve.log_records_service,
                "requeue_tournament",
                AsyncMock(return_value=TournamentRequeue(discipline="overwatch", queue=[], replay={})),
            ),
            patch.object(serve, "publish_message", publish),
        ):
            await serve.process_tournament_log(
                {"tournament_id": 42}, SimpleNamespace(headers={}, message_id=None, raw_message=None)
            )
        publish.assert_not_awaited()

    async def test_done_job_replays_go_to_the_ttl_less_replay_queue_with_their_revision_and_are_never_decoded_here(
        self,
    ):
        publish = AsyncMock()
        reparse = AsyncMock()
        with (
            patch.object(serve.db, "async_session_maker", session_factory(SimpleNamespace())),
            patch.object(
                serve.log_records_service,
                "requeue_tournament",
                AsyncMock(return_value=TournamentRequeue(discipline="overwatch", queue=[501], replay={601: 3})),
            ),
            patch.object(serve, "publish_message", publish),
            patch.object(serve, "reparse_authorized_job", reparse),
        ):
            await serve.process_tournament_log(
                {"tournament_id": 42}, SimpleNamespace(headers={}, message_id=None, raw_message=None)
            )
        reparse.assert_not_awaited()
        sent = [
            (c.args[1]["ingest_job_id"], c.args[1]["reparse_expected_revision"], c.args[2].name)
            for c in publish.await_args_list
        ]
        self.assertEqual([(501, None, "stats.ingest.overwatch"), (601, 3, "stats.ingest.overwatch.replay")], sent)
        replay_queue = publish.await_args_list[1].args[2]
        # A replay outlives any backlog: DONE jobs are not reaper-recoverable, so its queue must not expire messages.
        self.assertNotIn("x-message-ttl", replay_queue.arguments)
        self.assertIn("x-message-ttl", publish.await_args_list[0].args[2].arguments)
        self.assertTrue(replay_queue.durable)
        self.assertNotIn("persist", publish.await_args_list[1].kwargs)  # publish_message defaults to persistent

    async def test_the_replay_consumer_runs_the_revision_fenced_reparse_and_reports_stale(self):
        msg = SimpleNamespace(headers={}, message_id=None, raw_message=None)
        session = SimpleNamespace(scalar=AsyncMock(return_value="overwatch"), rollback=AsyncMock())
        for outcome, effect in (("ok", None), ("stale", serve.IngestRejected(409, "stale_revision", "stale"))):
            reparse = AsyncMock(side_effect=effect)
            claim = AsyncMock()
            with (
                self.subTest(outcome),
                patch.object(serve.db, "async_session_maker", session_factory(session)),
                patch.object(serve, "reparse_authorized_job", reparse),
                patch.object(serve, "process_ingest_job", claim),
            ):
                await serve.process_replay_message(
                    "overwatch", {"ingest_job_id": 601, "reparse_expected_revision": 3}, msg
                )
            reparse.assert_awaited_once_with(session, job_id=601, expected_revision=3, s3=serve.s3_client)
            claim.assert_not_awaited()

    async def test_a_replay_delivered_to_a_worker_of_another_discipline_is_refused_undecoded(self):
        msg = SimpleNamespace(headers={}, message_id=None, raw_message=None)
        session = SimpleNamespace(scalar=AsyncMock(return_value="overwatch"), rollback=AsyncMock())
        reparse = AsyncMock()
        with (
            patch.object(serve.db, "async_session_maker", session_factory(session)),
            patch.object(serve, "reparse_authorized_job", reparse),
            self.assertRaises(ValueError),
        ):
            await serve.process_replay_message("lol", {"ingest_job_id": 601, "reparse_expected_revision": 3}, msg)
        reparse.assert_not_awaited()

    async def test_a_replay_request_on_the_ttl_ingest_queue_is_refused_and_a_plain_one_on_replay_too(self):
        msg = SimpleNamespace(headers={}, message_id=None, raw_message=None)
        reparse, claim = AsyncMock(), AsyncMock()
        with patch.object(serve, "reparse_authorized_job", reparse), patch.object(serve, "process_ingest_job", claim):
            with self.assertRaises(ValueError):
                await serve.process_ingest_message(
                    "overwatch", {"ingest_job_id": 601, "reparse_expected_revision": 3}, msg
                )
            with self.assertRaises(ValueError):
                await serve.process_replay_message("overwatch", {"ingest_job_id": 601}, msg)
        reparse.assert_not_awaited()
        claim.assert_not_awaited()
