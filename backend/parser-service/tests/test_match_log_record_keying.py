"""How ``process_match_log`` keys and terminates LogProcessingRecord rows.

Two ways a log used to sit on "Queued" forever:

* The bulk path hands over a full S3 key (``logs/{tournament_id}/{name}``) while
  every record stores a bare object name — ``uploads.validate_log_filename``
  rejects ``/``. Record lookups on the prefixed form matched nothing, forked a
  duplicate ``manual`` row and left the uploaded one on ``pending``.
* The missing / oversized S3 guards fire *before* ``set_processing``, so the row
  never left ``pending`` and never spent a reaper attempt (``attempts`` is only
  bumped by ``set_processing``) — the stall reaper republished it every window
  forever, because its ``max_attempts`` guard could not trip.
"""

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

flows = importlib.import_module("src.services.match_logs.flows")
record_service = importlib.import_module("src.services.match_logs.log_records")
errors = importlib.import_module("shared.core.errors")

PREFIXED = "logs/42/Log-2026-07-19-20-15-39.txt"
BARE = "Log-2026-07-19-20-15-39.txt"


class MatchLogRecordKeyingTests(IsolatedAsyncioTestCase):
    def setUp(self) -> None:
        self.session = SimpleNamespace()
        self.tournament = SimpleNamespace(id=42, name="Spring Cup")
        self.s3 = SimpleNamespace()

    async def test_bulk_s3_key_is_stripped_to_the_stored_object_name(self) -> None:
        raw_bytes = b"line1\nline2\n"

        with (
            patch.object(flows.tournament_flows, "get", AsyncMock(return_value=self.tournament)),
            patch.object(flows.s3_service, "get_log_by_filename", AsyncMock(return_value=raw_bytes)),
            patch.object(record_service, "is_already_processed", AsyncMock(return_value=False)) as already,
            patch.object(record_service, "set_processing", AsyncMock(return_value=None)) as set_processing,
            patch.object(record_service, "set_done", AsyncMock()),
            patch.object(flows, "MatchLogProcessor") as processor_cls,
        ):
            processor_cls.return_value = SimpleNamespace(start=AsyncMock())

            await flows.process_match_log(self.session, 42, PREFIXED, self.s3, is_raise=True)

        self.assertEqual(BARE, already.await_args.args[2])
        self.assertEqual(BARE, set_processing.await_args.args[2])
        # The processor is fed the bare name too (it names the parsed match file).
        self.assertEqual(BARE, processor_cls.call_args.args[1])

    async def test_duplicate_bulk_key_finalizes_the_bare_named_record(self) -> None:
        raw_bytes = b"line1\nline2\n"

        with (
            patch.object(flows.tournament_flows, "get", AsyncMock(return_value=self.tournament)),
            patch.object(flows.s3_service, "get_log_by_filename", AsyncMock(return_value=raw_bytes)),
            patch.object(record_service, "is_already_processed", AsyncMock(return_value=True)),
            patch.object(record_service, "finish_duplicate_record", AsyncMock()) as finish,
            patch.object(flows, "MatchLogProcessor") as processor_cls,
        ):
            await flows.process_match_log(self.session, 42, PREFIXED, self.s3, is_raise=True)

        processor_cls.assert_not_called()
        self.assertEqual(BARE, finish.await_args.args[2])

    async def test_missing_s3_object_fails_the_record_instead_of_leaving_it_queued(self) -> None:
        with (
            patch.object(flows.tournament_flows, "get", AsyncMock(return_value=self.tournament)),
            patch.object(flows.s3_service, "get_log_by_filename", AsyncMock(return_value=None)),
            patch.object(record_service, "fail_unstarted", AsyncMock()) as fail_unstarted,
        ):
            with self.assertRaises(errors.ApiHTTPException):
                await flows.process_match_log(self.session, 42, PREFIXED, self.s3, is_raise=True)

        fail_unstarted.assert_awaited_once()
        self.assertEqual(BARE, fail_unstarted.await_args.args[2])
        self.assertIn("not found", fail_unstarted.await_args.args[3])

    async def test_oversized_log_fails_the_record_on_the_silent_bulk_path(self) -> None:
        oversized = b"x" * (flows.settings.max_match_log_bytes + 1)

        with (
            patch.object(flows.tournament_flows, "get", AsyncMock(return_value=self.tournament)),
            patch.object(flows.s3_service, "get_log_by_filename", AsyncMock(return_value=oversized)),
            patch.object(record_service, "fail_unstarted", AsyncMock()) as fail_unstarted,
            patch.object(flows, "MatchLogProcessor") as processor_cls,
        ):
            # is_raise=False is the bulk path: it must still land the row on a
            # terminal status rather than returning quietly.
            await flows.process_match_log(self.session, 42, PREFIXED, self.s3, is_raise=False)

        processor_cls.assert_not_called()
        fail_unstarted.assert_awaited_once()
        self.assertIn("maximum size", fail_unstarted.await_args.args[3])


class FailUnstartedTests(IsolatedAsyncioTestCase):
    class _Session:
        def __init__(self, record) -> None:
            self._record = record
            self.commits = 0

        async def execute(self, _statement):
            record = self._record
            return SimpleNamespace(scalar_one_or_none=lambda: record)

        async def commit(self) -> None:
            self.commits += 1

    async def test_pending_record_becomes_failed_with_the_reason(self) -> None:
        record = SimpleNamespace(
            status=record_service.LogProcessingStatus.pending,
            finished_at=None,
            error_message=None,
        )
        session = self._Session(record)

        result = await record_service.fail_unstarted(session, 42, BARE, "Log file missing in S3")

        self.assertIs(record, result)
        self.assertEqual(record_service.LogProcessingStatus.failed, record.status)
        self.assertEqual("Log file missing in S3", record.error_message)
        self.assertIsNotNone(record.finished_at)
        self.assertEqual(1, session.commits)

    async def test_no_unfinished_record_is_a_no_op(self) -> None:
        session = self._Session(None)

        self.assertIsNone(await record_service.fail_unstarted(session, 42, BARE, "boom"))
        self.assertEqual(0, session.commits)
