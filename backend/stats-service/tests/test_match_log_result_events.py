"""Tests for publishing match-log processing results back to discord-service.

The result goes to one durable work queue and names the Discord message it answers. Publishing must never fail
the worker.
"""

from __future__ import annotations

import importlib
import sys
from pathlib import Path
from types import SimpleNamespace
from unittest import IsolatedAsyncioTestCase
from unittest.mock import AsyncMock, patch

backend_root = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(backend_root))
sys.path.insert(0, str(backend_root / "stats-service"))


result_events = importlib.import_module("src.services.match_logs.result_events")

from shared.schemas.events import ProcessIngestJobEvent


class PublishMatchLogResultTests(IsolatedAsyncioTestCase):
    def test_processing_payload_requires_native_job_id(self) -> None:
        event = ProcessIngestJobEvent(ingest_job_id=7, correlation_id="upload-7")
        self.assertEqual(7, event.ingest_job_id)
        self.assertNotIn("filename", event.model_dump())
        self.assertNotIn("tournament_id", event.model_dump())
        for payload in ({"tournament_id": 1, "filename": "old.log"}, {"ingest_job_id": 0}):
            with self.subTest(payload=payload), self.assertRaises(ValueError):
                ProcessIngestJobEvent.model_validate(payload)

    def test_only_prejob_failure_can_omit_job_id(self) -> None:
        for status in ("done", "awaiting_link"):
            with self.subTest(status=status), self.assertRaises(ValueError):
                result_events.MatchLogProcessedEvent(tournament_id=1, filename="x", status=status)
        event = result_events.MatchLogProcessedEvent(
            tournament_id=None,
            filename="x",
            status="failed",
            error_message="Upload rejected",
        )
        self.assertIsNone(event.ingest_job_id)

    async def test_publishes_done_event_to_the_result_queue_with_the_upload_message(self) -> None:
        broker = SimpleNamespace()
        with patch.object(result_events, "publish_message", AsyncMock()) as publish:
            await result_events.publish_match_log_result(
                broker, 73, "log.txt", "done", ingest_job_id=91, correlation_id="upload-1", channel_id=5, message_id=6
            )

        self.assertEqual(1, publish.await_count)
        args, kwargs = publish.await_args
        self.assertIs(broker, args[0])
        payload = args[1]
        self.assertEqual("match_log_processed", payload["event_type"])
        self.assertEqual(73, payload["tournament_id"])
        self.assertEqual("log.txt", payload["filename"])
        self.assertEqual("done", payload["status"])
        self.assertEqual(91, payload["ingest_job_id"])
        self.assertEqual("upload-1", payload["correlation_id"])
        self.assertEqual((5, 6), (payload["channel_id"], payload["message_id"]))
        self.assertEqual("upload-1", kwargs["correlation_id"])
        self.assertIs(result_events.MATCH_LOG_RESULT_QUEUE, args[2])

    async def test_publishes_failed_status(self) -> None:
        with patch.object(result_events, "publish_message", AsyncMock()) as publish:
            await result_events.publish_match_log_result(SimpleNamespace(), 1, "x", "failed")
        payload = publish.await_args.args[1]
        self.assertEqual("failed", payload["status"])

    async def test_broker_error_is_swallowed(self) -> None:
        with patch.object(result_events, "publish_message", AsyncMock(side_effect=RuntimeError("down"))):
            # Must not raise — a failed result publish should never fail the worker.
            await result_events.publish_match_log_result(SimpleNamespace(), 1, "x", "done", ingest_job_id=1)

    async def test_awaiting_link_keeps_job_and_error(self) -> None:
        with patch.object(result_events, "publish_message", AsyncMock()) as publish:
            await result_events.publish_match_log_result(
                SimpleNamespace(),
                1,
                "x",
                "awaiting_link",
                ingest_job_id=8,
                correlation_id="upload-8",
                error_message="Link this log to a game",
            )
        payload = publish.await_args.args[1]
        self.assertEqual(
            ("awaiting_link", 8, "upload-8", "Link this log to a game"),
            (payload["status"], payload["ingest_job_id"], payload["correlation_id"], payload["error_message"]),
        )
