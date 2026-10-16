"""Transport regressions around native job processing (real DB flow has its own suite)."""

from __future__ import annotations

import asyncio
import base64
import importlib
import os
import sys
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

backend_root = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(backend_root))
sys.path.insert(0, str(backend_root / "parser-service"))
os.environ["DEBUG"] = "true"

from shared.models import IngestJobStatus
from tests._fakes import session_factory

serve = importlib.import_module("serve")
MESSAGE = SimpleNamespace(headers={}, message_id=None, raw_message=None)


def _event(content_b64=None):
    return {
        "tournament_id": 42,
        "filename": "same.log",
        "correlation_id": "upload-before-publish",
        "content_b64": content_b64 if content_b64 is not None else base64.b64encode(b"actual bytes").decode(),
    }


def test_upload_queues_native_job_and_preserves_original_correlation(monkeypatch):
    async def run():
        session = SimpleNamespace(scalar=AsyncMock(return_value=None))
        monkeypatch.setattr(serve.db, "async_session_maker", session_factory(session))
        store = AsyncMock(return_value=SimpleNamespace(id=66))
        publish = AsyncMock()
        monkeypatch.setattr(serve.upload_service, "store_uploaded_log_bytes", store)
        monkeypatch.setattr(serve, "publish_message", publish)
        await serve.process_upload_match_log(_event(), MESSAGE)
        payload = publish.await_args.args[1]
        assert payload["ingest_job_id"] == 66 and payload["correlation_id"] == "upload-before-publish"
        assert "filename" not in payload and "tournament_id" not in payload
        assert store.await_args.kwargs["content"] == b"actual bytes"

    asyncio.run(run())


def test_invalid_base64_reports_failed_upload_before_a_job_exists(monkeypatch):
    async def run():
        store, result = AsyncMock(), AsyncMock()
        monkeypatch.setattr(serve.upload_service, "store_uploaded_log_bytes", store)
        monkeypatch.setattr(serve, "publish_match_log_result", result)
        await serve.process_upload_match_log(_event("!not-base64!"), MESSAGE)
        store.assert_not_awaited()
        assert result.await_args.args[3] == "failed"
        assert result.await_args.kwargs["ingest_job_id"] is None
        assert result.await_args.kwargs["correlation_id"] == "upload-before-publish"
        assert result.await_args.kwargs["error_message"]

    asyncio.run(run())


def test_dispatch_outage_does_not_forge_a_failed_parse_for_a_pending_job(monkeypatch):
    async def run():
        monkeypatch.setattr(serve.db, "async_session_maker", session_factory(SimpleNamespace()))
        monkeypatch.setattr(
            serve.upload_service, "store_uploaded_log_bytes", AsyncMock(return_value=SimpleNamespace(id=66))
        )
        monkeypatch.setattr(serve, "publish_message", AsyncMock(side_effect=RuntimeError("queue down")))
        result = AsyncMock()
        monkeypatch.setattr(serve, "publish_match_log_result", result)
        with pytest.raises(RuntimeError, match="queue down"):
            await serve.process_upload_match_log(_event(), MESSAGE)
        result.assert_not_awaited()

    asyncio.run(run())


@pytest.mark.parametrize("status", [IngestJobStatus.DONE, IngestJobStatus.FAILED, IngestJobStatus.AWAITING_LINK])
def test_processing_result_uses_committed_native_status_and_job_error(monkeypatch, status):
    async def run():
        row = SimpleNamespace(id=66, hint_tournament_id=42, filename="canonical.log", error_message="native-job-error")
        session = SimpleNamespace(get=AsyncMock(return_value=row))
        monkeypatch.setattr(serve.db, "async_session_maker", session_factory(session))
        process = AsyncMock(return_value=status)
        result = AsyncMock()
        monkeypatch.setattr(serve.logs_flows, "process_match_log", process)
        monkeypatch.setattr(serve, "publish_match_log_result", result)
        await serve.process_match_log_async({"ingest_job_id": 66, "correlation_id": "original-upload"}, MESSAGE)
        process.assert_awaited_once_with(session, 66, serve.s3_client, is_raise=False)
        assert result.await_args.args[1:4] == (42, "canonical.log", status.value)
        assert result.await_args.kwargs["ingest_job_id"] == 66
        assert result.await_args.kwargs["correlation_id"] == "original-upload"
        assert result.await_args.kwargs["error_message"] == "native-job-error"

    asyncio.run(run())


def test_active_duplicate_acknowledges_without_completing_original_correlation(monkeypatch):
    async def run():
        session = SimpleNamespace(get=AsyncMock())
        monkeypatch.setattr(serve.db, "async_session_maker", session_factory(session))
        process = AsyncMock(return_value=IngestJobStatus.PROCESSING)
        result = AsyncMock()
        monkeypatch.setattr(serve.logs_flows, "process_match_log", process)
        monkeypatch.setattr(serve, "publish_match_log_result", result)
        await serve.process_match_log_async({"ingest_job_id": 66, "correlation_id": "original-upload"}, MESSAGE)
        process.assert_awaited_once_with(session, 66, serve.s3_client, is_raise=False)
        session.get.assert_not_awaited()
        result.assert_not_awaited()

    asyncio.run(run())
