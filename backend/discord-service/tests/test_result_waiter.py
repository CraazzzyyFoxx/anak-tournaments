"""The upload id, not a display filename, owns the complete processing result."""

import asyncio
import sys
from pathlib import Path
from unittest import IsolatedAsyncioTestCase

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from shared.schemas.events import MatchLogProcessedEvent
from src.result_waiter import ResultWaiter


def result(correlation_id, status="done", *, job_id=11, error=None):
    return MatchLogProcessedEvent(
        tournament_id=73,
        filename="same.log",
        correlation_id=correlation_id,
        ingest_job_id=job_id,
        status=status,
        error_message=error,
    )


class ResultWaiterTests(IsolatedAsyncioTestCase):
    async def test_result_arriving_during_publish_is_not_lost(self):
        waiter = ResultWaiter(timeout=1)
        waiter.register("upload-a")
        payload = result("upload-a")
        waiter.resolve(payload)
        self.assertIs(await waiter.wait("upload-a"), payload)
        self.assertEqual({}, waiter._pending)

    async def test_complete_failed_and_awaiting_results_survive(self):
        waiter = ResultWaiter(timeout=1)
        for status in ("failed", "awaiting_link"):
            waiter.register(status)
            payload = result(status, status, job_id=19, error="Administrator must link this game")
            waiter.resolve(payload)
            self.assertIs(await waiter.wait(status), payload)
            self.assertEqual(19, payload.ingest_job_id)

    async def test_same_filename_uploads_do_not_resolve_each_other(self):
        waiter = ResultWaiter(timeout=1)
        waiter.register("a")
        waiter.register("b")
        a, b = result("a", job_id=1), result("b", "failed", job_id=2, error="bad bytes")
        waiter.resolve(b)
        self.assertFalse(waiter._pending["a"].done())
        waiter.resolve(a)
        self.assertIs(await waiter.wait("a"), a)
        self.assertIs(await waiter.wait("b"), b)

    async def test_timeout_and_publish_failure_remove_the_registration(self):
        waiter = ResultWaiter(timeout=0.001)
        waiter.register("timeout")
        self.assertIsNone(await waiter.wait("timeout"))
        future = waiter.register("publish-failed")
        waiter.cancel("publish-failed")
        self.assertTrue(future.cancelled())
        waiter.resolve(result("timeout"))
        waiter.resolve(result("publish-failed"))
        self.assertEqual({}, waiter._pending)

    async def test_cancellation_cleans_up_and_duplicate_registration_is_rejected(self):
        waiter = ResultWaiter(timeout=1)
        waiter.register("a")
        with self.assertRaises(ValueError):
            waiter.register("a")
        task = asyncio.create_task(waiter.wait("a"))
        await asyncio.sleep(0)
        task.cancel()
        with self.assertRaises(asyncio.CancelledError):
            await task
        self.assertEqual({}, waiter._pending)

    async def test_upload_failure_can_precede_job_creation(self):
        waiter = ResultWaiter(timeout=1)
        waiter.register("a")
        payload = result("a", "failed", job_id=None, error="Object storage unavailable")
        waiter.resolve(payload)
        self.assertIs(await waiter.wait("a"), payload)
