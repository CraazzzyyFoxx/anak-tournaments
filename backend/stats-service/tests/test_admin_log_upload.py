"""The match-log admin RPC handlers, driven through ``rpc.logs.register`` on a fake broker: uploads queue each file
with its attached encounter, history and stats filter the scope. The cross-tournament encounter rejection is
exercised directly against ``admin_reads._validate_attached_encounter``.
"""

from __future__ import annotations

import base64
import importlib
import logging
import os
import sys
from pathlib import Path
from types import SimpleNamespace
from unittest import IsolatedAsyncioTestCase
from unittest.mock import AsyncMock, patch

from shared.core.errors import BaseAPIException as HTTPException

backend_root = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(backend_root))
sys.path.insert(0, str(backend_root / "stats-service"))

os.environ["DEBUG"] = "true"

from tests._fakes import FakeBroker as _FakeBroker
from tests._fakes import active_identity as _active_identity
from tests._fakes import session_factory as _session_factory

rpc_logs = importlib.import_module("src.rpc.logs")
admin_reads = importlib.import_module("src.services.match_logs.admin_reads")
uploads = importlib.import_module("src.services.match_logs.uploads")
CUP = SimpleNamespace(id=42, name="Cup", workspace_id=5)

FINISHED_LOG = b"0,match_start,0,Ilios,Control,Home,Away\n0,match_end,100,Home,2,0\n"
# Still being written: rows exist, but no match_end yet.
UNFINISHED_LOG = b"0,match_start,0,Ilios,Control,Home,Away\n0,round_start,5,1\n"
FINISHED_B64 = base64.b64encode(FINISHED_LOG).decode()
UNFINISHED_B64 = base64.b64encode(UNFINISHED_LOG).decode()


class _Result:
    def __init__(self, value=None, values=None, row=None) -> None:
        self._value = value
        self._values = [] if values is None else values
        self._row = row

    def scalar_one_or_none(self):
        return self._value

    def scalars(self):
        return SimpleNamespace(all=lambda: self._values)

    def one(self):
        return self._row

    def all(self):
        return self._values


class AdminLogUploadRpcTests(IsolatedAsyncioTestCase):
    def setUp(self) -> None:
        self.broker = _FakeBroker()
        rpc_logs.register(self.broker, logging.getLogger("test"))
        self._original_sf = rpc_logs._SF

    def tearDown(self) -> None:
        rpc_logs._SF = self._original_sf

    async def test_upload_queues_each_file_with_attached_encounter(self) -> None:
        audit_rows: list = []
        session = SimpleNamespace(add=audit_rows.append, rollback=AsyncMock())
        rpc_logs._SF = _session_factory(session)

        async def store_uploaded_log_bytes(*args, **kwargs):
            return SimpleNamespace(
                id=100,
                discipline="overwatch",
                filename=kwargs["filename"],
                hint_encounter_id=kwargs["attached_encounter_id"],
            )

        with (
            patch.object(rpc_logs.auth, "require_tournament_id_permission", AsyncMock()),
            patch.object(uploads.upload_service._tournaments, "get", AsyncMock(return_value=CUP)),
            patch.object(uploads, "_validate_attached_encounter", AsyncMock(return_value=SimpleNamespace(id=9))),
            patch.object(uploads.upload_service, "validate_log_filename", side_effect=lambda name: name),
            patch.object(uploads.upload_service, "resolve_auth_uploader_id", AsyncMock(return_value=777)),
            patch.object(
                uploads.upload_service,
                "store_uploaded_log_bytes",
                AsyncMock(side_effect=store_uploaded_log_bytes),
            ) as store_mock,
            patch.object(uploads, "quota", SimpleNamespace(charge=AsyncMock())) as quota_mock,
        ):
            envelope = await self.broker.handlers["rpc.stats.logs.upload"](
                {
                    "identity": _active_identity(),
                    "tournament_id": 42,
                    "encounter_id": 9,
                    "files": [
                        {"filename": "one.log", "content_b64": FINISHED_B64},
                        {"filename": "two.log", "content_b64": FINISHED_B64},
                    ],
                },
                msg=None,
            )

        self.assertTrue(envelope["ok"], envelope)
        data = envelope["data"]
        self.assertEqual([], data["errors"])
        self.assertEqual(["one.log", "two.log"], [item["filename"] for item in data["uploaded"]])
        self.assertEqual([9, 9], [item["attached_encounter_id"] for item in data["uploaded"]])
        self.assertEqual(2, store_mock.await_count)
        for call in store_mock.await_args_list:
            self.assertEqual(42, call.kwargs["tournament_id"])
            self.assertEqual(777, call.kwargs["uploader_id"])
            self.assertEqual(9, call.kwargs["attached_encounter_id"])
            self.assertEqual("upload", call.kwargs["source"])

        # One audit row for the call — file names only, never the uploaded bytes.
        self.assertEqual(1, len(audit_rows))
        row = audit_rows[0]
        self.assertEqual("match_log.upload", row.action)
        self.assertEqual(5, row.workspace_id)
        self.assertEqual("tournament", row.entity_type)
        self.assertEqual(42, row.entity_id)
        self.assertEqual({"filenames": ["one.log", "two.log"]}, row.after_json)

        # One charge for the whole batch, carrying both dimensions the per-request
        # caps are compared against — not one charge per file.
        quota_mock.charge.assert_awaited_once()
        charge = quota_mock.charge.await_args
        self.assertEqual("stats.logs.upload", charge.args[1])
        self.assertEqual(5, charge.kwargs["workspace_id"])
        self.assertEqual(2, charge.kwargs["item_count"])
        self.assertEqual(2 * len(FINISHED_B64), charge.kwargs["size_bytes"])

    async def test_upload_rejects_unfinished_log_without_storing_it(self) -> None:
        rpc_logs._SF = _session_factory(SimpleNamespace(add=lambda row: None, rollback=AsyncMock()))

        with (
            patch.object(rpc_logs.auth, "require_tournament_id_permission", AsyncMock()),
            patch.object(uploads.upload_service._tournaments, "get", AsyncMock(return_value=CUP)),
            patch.object(uploads, "_validate_attached_encounter", AsyncMock(return_value=None)),
            patch.object(uploads.upload_service, "validate_log_filename", side_effect=lambda name: name),
            patch.object(uploads.upload_service, "resolve_auth_uploader_id", AsyncMock(return_value=777)),
            patch.object(
                uploads.upload_service,
                "store_uploaded_log_bytes",
                AsyncMock(
                    return_value=SimpleNamespace(
                        id=1, discipline="overwatch", filename="done.log", hint_encounter_id=None
                    )
                ),
            ) as store_mock,
            patch.object(uploads, "quota", SimpleNamespace(charge=AsyncMock())),
        ):
            envelope = await self.broker.handlers["rpc.stats.logs.upload"](
                {
                    "identity": _active_identity(),
                    "tournament_id": 42,
                    "files": [
                        {"filename": "done.log", "content_b64": FINISHED_B64},
                        {"filename": "live.log", "content_b64": UNFINISHED_B64},
                    ],
                },
                msg=None,
            )

        self.assertTrue(envelope["ok"], envelope)
        data = envelope["data"]
        self.assertEqual(["done.log"], [item["filename"] for item in data["uploaded"]])
        self.assertEqual(
            [{"filename": "live.log", "error": uploads.MATCH_NOT_FINISHED_MESSAGE}],
            data["errors"],
        )
        self.assertEqual(["done.log"], [call.kwargs["filename"] for call in store_mock.await_args_list])

    async def test_history_rejects_unknown_status(self) -> None:
        rpc_logs._SF = _session_factory(SimpleNamespace())

        with patch.object(rpc_logs.auth, "require_tournament_id_permission", AsyncMock()):
            envelope = await self.broker.handlers["rpc.stats.logs.history"](
                {
                    "identity": _active_identity(),
                    "query": {"tournament_id": ["42"], "status": ["burning"]},
                },
                msg=None,
            )

        self.assertFalse(envelope["ok"], envelope)
        self.assertEqual("unprocessable", envelope["error"]["code"])
        self.assertIn("status must be one of", envelope["error"]["message"])

    async def test_stats_returns_scope_wide_aggregate(self) -> None:
        """KPIs come from one aggregate over the whole scope, not the visible page."""
        session = SimpleNamespace(
            execute=AsyncMock(return_value=_Result(row=(11, 1, 2, 6, 1, 1, 3.5, "2026-07-30T10:00:00+00:00")))
        )
        rpc_logs._SF = _session_factory(session)

        with patch.object(rpc_logs.auth, "require_tournament_id_permission", AsyncMock()):
            envelope = await self.broker.handlers["rpc.stats.logs.stats"](
                {"identity": _active_identity(), "query": {"tournament_id": ["42"]}},
                msg=None,
            )

        self.assertTrue(envelope["ok"], envelope)
        data = envelope["data"]
        self.assertEqual(11, data["total"])
        self.assertEqual((1, 2, 6, 1), (data["pending"], data["processing"], data["done"], data["failed"]))
        self.assertEqual(1, data["awaiting_link"])
        self.assertEqual(3.5, data["avg_duration_seconds"])


class ValidateAttachedEncounterTests(IsolatedAsyncioTestCase):
    async def test_rejects_encounter_from_another_tournament(self) -> None:
        session = SimpleNamespace(
            execute=AsyncMock(return_value=_Result(SimpleNamespace(id=9, tournament_id=99, name="A vs B")))
        )

        with self.assertRaises(HTTPException) as ctx:
            await admin_reads._validate_attached_encounter(session, tournament_id=42, encounter_id=9)

        self.assertEqual(400, ctx.exception.status_code)
        self.assertIn("does not belong", ctx.exception.detail)

    async def test_returns_none_when_no_encounter_attached(self) -> None:
        session = SimpleNamespace(execute=AsyncMock())
        result = await admin_reads._validate_attached_encounter(session, tournament_id=42, encounter_id=None)
        self.assertIsNone(result)
        session.execute.assert_not_awaited()


class MatchLogOversizeMessageTests(IsolatedAsyncioTestCase):
    def test_under_cap_is_silent(self) -> None:
        from src.services.match_logs.limits import match_log_oversize_message

        self.assertIsNone(match_log_oversize_message(10, 10))

    def test_over_cap_names_the_file_when_given(self) -> None:
        from src.services.match_logs.limits import match_log_oversize_message

        self.assertEqual(
            "Log file exceeds the maximum size of 10 bytes",
            match_log_oversize_message(11, 10),
        )
        self.assertEqual(
            "Log file a.log exceeds the maximum size of 10 bytes",
            match_log_oversize_message(11, 10, filename="a.log"),
        )


class MatchLogFinishedTests(IsolatedAsyncioTestCase):
    def test_needs_match_end_in_the_event_column(self) -> None:
        from src.services.match_logs.limits import match_log_finished

        self.assertTrue(match_log_finished(FINISHED_LOG))
        self.assertFalse(match_log_finished(UNFINISHED_LOG))
        self.assertFalse(match_log_finished(b""))
        # A player literally named "match_end" is data, not the event.
        self.assertFalse(match_log_finished(b"0,player_joined,1,Home,match_end\n"))
