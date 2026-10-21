"""Transport regressions around native job processing (real DB flow has its own suite)."""

from __future__ import annotations

import asyncio
import base64
import importlib
import sys
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from loguru import logger

backend_root = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(backend_root))
sys.path.insert(0, str(backend_root / "stats-service"))


from shared.models import IngestJobStatus
from tests._fakes import session_factory

uploads = importlib.import_module("src.services.match_logs.consumers")
ingest = importlib.import_module("src.services.ingest.consumers")
MESSAGE = SimpleNamespace(headers={}, message_id=None, raw_message=None)
BROKER = object()


def _event(content_b64=None):
    return {
        "tournament_id": 42,
        "filename": "same.log",
        "correlation_id": "upload-before-publish",
        "channel_id": 7001,
        "message_id": 7002,
        "content_b64": content_b64 if content_b64 is not None else base64.b64encode(b"actual bytes").decode(),
    }


def test_upload_stores_the_job_with_its_request_carrying_the_upload_ids(monkeypatch):
    async def run():
        session = SimpleNamespace(scalar=AsyncMock(return_value=None))
        monkeypatch.setattr(uploads.db, "async_session_maker", session_factory(session))
        store = AsyncMock(return_value=SimpleNamespace(id=66, discipline="overwatch"))
        result = AsyncMock()
        monkeypatch.setattr(uploads.upload_service, "store_uploaded_log_bytes", store)
        monkeypatch.setattr(uploads, "publish_match_log_result", result)
        await uploads.process_upload_match_log(_event(), MESSAGE, broker=BROKER, logger=logger)
        kwargs = store.await_args.kwargs
        assert kwargs["content"] == b"actual bytes"
        assert (kwargs["correlation_id"], kwargs["channel_id"], kwargs["message_id"]) == (
            "upload-before-publish",
            7001,
            7002,
        )
        result.assert_not_awaited()

    asyncio.run(run())


def test_invalid_base64_reports_failed_upload_before_a_job_exists(monkeypatch):
    async def run():
        store, result = AsyncMock(), AsyncMock()
        monkeypatch.setattr(uploads.upload_service, "store_uploaded_log_bytes", store)
        monkeypatch.setattr(uploads, "publish_match_log_result", result)
        await uploads.process_upload_match_log(_event("!not-base64!"), MESSAGE, broker=BROKER, logger=logger)
        store.assert_not_awaited()
        assert result.await_args.args[3] == "failed"
        assert "ingest_job_id" not in result.await_args.kwargs
        assert result.await_args.kwargs["correlation_id"] == "upload-before-publish"
        assert (result.await_args.kwargs["channel_id"], result.await_args.kwargs["message_id"]) == (7001, 7002)
        assert result.await_args.kwargs["error_message"]

    asyncio.run(run())


@pytest.mark.parametrize("status", [IngestJobStatus.DONE, IngestJobStatus.FAILED, IngestJobStatus.AWAITING_LINK])
def test_processing_result_uses_committed_native_status_and_job_error(monkeypatch, status):
    async def run():
        row = SimpleNamespace(id=66, hint_tournament_id=42, filename="canonical.log", error_message="native-job-error")
        session = SimpleNamespace(
            get=AsyncMock(return_value=row), scalar=AsyncMock(return_value="overwatch"), rollback=AsyncMock()
        )
        monkeypatch.setattr(ingest.db, "async_session_maker", session_factory(session))
        process = AsyncMock(return_value=status)
        result = AsyncMock()
        monkeypatch.setattr(ingest, "process_ingest_job", process)
        monkeypatch.setattr(ingest, "publish_match_log_result", result)
        await ingest.process_ingest_message(
            "overwatch",
            {"ingest_job_id": 66, "correlation_id": "original-upload", "channel_id": 7001, "message_id": 7002},
            MESSAGE,
            broker=BROKER,
            logger=logger,
        )
        process.assert_awaited_once_with(session, 66, ingest.s3_client, is_raise=False)
        assert result.await_args.args[1:4] == (42, "canonical.log", status.value)
        assert result.await_args.kwargs["ingest_job_id"] == 66
        assert result.await_args.kwargs["correlation_id"] == "original-upload"
        assert result.await_args.kwargs["error_message"] == "native-job-error"
        assert (result.await_args.kwargs["channel_id"], result.await_args.kwargs["message_id"]) == (7001, 7002)

    asyncio.run(run())


def test_active_duplicate_acknowledges_without_completing_original_correlation(monkeypatch):
    async def run():
        session = SimpleNamespace(get=AsyncMock(), scalar=AsyncMock(return_value="overwatch"), rollback=AsyncMock())
        monkeypatch.setattr(ingest.db, "async_session_maker", session_factory(session))
        process = AsyncMock(return_value=IngestJobStatus.PROCESSING)
        result = AsyncMock()
        monkeypatch.setattr(ingest, "process_ingest_job", process)
        monkeypatch.setattr(ingest, "publish_match_log_result", result)
        await ingest.process_ingest_message(
            "overwatch",
            {"ingest_job_id": 66, "correlation_id": "original-upload"},
            MESSAGE,
            broker=BROKER,
            logger=logger,
        )
        process.assert_awaited_once_with(session, 66, ingest.s3_client, is_raise=False)
        session.get.assert_not_awaited()
        result.assert_not_awaited()

    asyncio.run(run())


def test_a_job_of_another_discipline_is_refused_before_any_claim(monkeypatch):
    async def run():
        session = SimpleNamespace(scalar=AsyncMock(return_value="lol"), rollback=AsyncMock())
        monkeypatch.setattr(ingest.db, "async_session_maker", session_factory(session))
        process, result = AsyncMock(), AsyncMock()
        monkeypatch.setattr(ingest, "process_ingest_job", process)
        monkeypatch.setattr(ingest, "publish_match_log_result", result)
        with pytest.raises(ValueError, match="'lol' job delivered to stats.ingest.overwatch"):
            await ingest.process_ingest_message(
                "overwatch", {"ingest_job_id": 66}, MESSAGE, broker=BROKER, logger=logger
            )
        process.assert_not_awaited()
        result.assert_not_awaited()

    asyncio.run(run())
