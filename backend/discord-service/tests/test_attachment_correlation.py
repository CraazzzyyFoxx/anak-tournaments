"""Drive the actual attachment pipeline through synchronous/early result delivery."""

import asyncio
import base64
import sys
from contextlib import asynccontextmanager
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock

import httpx
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from shared.schemas.events import MatchLogProcessedEvent
from src.feedback import AttachmentFeedbackState as State
from src.result_waiter import ResultWaiter
from src.services import attachment_processor as module


def processor(monkeypatch, waiter, *, contents=(b"first bytes",)):
    responses = [
        httpx.Response(200, content=body, request=httpx.Request("GET", "https://example.test/log")) for body in contents
    ]
    http = SimpleNamespace(get=AsyncMock(side_effect=responses))

    @asynccontextmanager
    async def client(**_kwargs):
        yield http

    monkeypatch.setattr(module, "optional_broker", lambda: object())
    instance = module.AttachmentProcessor(
        client=SimpleNamespace(),
        parser_clients=SimpleNamespace(create=AsyncMock(side_effect=client)),
        result_waiter=waiter,
    )
    attachment = SimpleNamespace(filename="same.log", url="https://example.test/log", content_type="text/plain")
    return instance, attachment, http


@pytest.mark.parametrize(
    "status,job_id,expected",
    [
        ("done", 8, State.PROCESSED_OK),
        ("failed", 9, State.PROCESSED_FAILED),
        ("failed", None, State.UPLOAD_FAILED),
        ("awaiting_link", 10, State.AWAITING_LINK),
    ],
)
def test_result_received_before_publish_returns_is_not_lost(monkeypatch, status, job_id, expected):
    async def run():
        waiter = ResultWaiter(timeout=0.1)
        instance, attachment, http = processor(monkeypatch, waiter)

        async def publish(_broker, payload, _queue, **kwargs):
            assert payload["event_id"] == payload["correlation_id"] == kwargs["correlation_id"]
            assert base64.b64decode(payload["content_b64"]) == b"first bytes"
            waiter.resolve(
                MatchLogProcessedEvent(
                    tournament_id=3,
                    filename="server-canonical.log",
                    status=status,
                    ingest_job_id=job_id,
                    correlation_id=payload["event_id"],
                    error_message="this exact upload",
                )
            )

        monkeypatch.setattr(module, "publish_message", publish)
        result = await instance.process_attachment(3, attachment)
        assert result.state == expected
        if expected != State.PROCESSED_OK:
            assert result.error_message == "this exact upload"
        assert not waiter._pending
        http.get.assert_awaited_once_with(attachment.url)

    asyncio.run(run())


def test_same_filename_uploads_download_bytes_and_receive_only_their_own_outcome(monkeypatch):
    async def run():
        waiter = ResultWaiter(timeout=1)
        instance, attachment, http = processor(monkeypatch, waiter, contents=(b"first bytes", b"changed bytes"))
        correlations = []

        async def publish(_broker, payload, _queue, **kwargs):
            correlations.append(payload["correlation_id"])
            content = base64.b64decode(payload["content_b64"])
            waiter.resolve(
                MatchLogProcessedEvent(
                    tournament_id=3,
                    filename="same.log",
                    status="failed",
                    ingest_job_id=len(correlations),
                    correlation_id=payload["correlation_id"],
                    error_message=content.decode(),
                )
            )

        monkeypatch.setattr(module, "publish_message", publish)
        results = await asyncio.gather(
            instance.process_attachment(3, attachment), instance.process_attachment(3, attachment)
        )
        assert [result.error_message for result in results] == ["first bytes", "changed bytes"]
        assert len(set(correlations)) == 2 and http.get.await_count == 2
        assert not waiter._pending

    asyncio.run(run())


def test_publish_failure_and_timeout_release_pending_registration(monkeypatch):
    async def run():
        waiter = ResultWaiter(timeout=0.001)
        instance, attachment, _ = processor(monkeypatch, waiter, contents=(b"one", b"two"))
        monkeypatch.setattr(module, "publish_message", AsyncMock(side_effect=RuntimeError("broker unavailable")))
        result = await instance.process_attachment(3, attachment)
        assert result.state == State.UPLOAD_FAILED and not waiter._pending
        monkeypatch.setattr(module, "publish_message", AsyncMock())
        result = await instance.process_attachment(3, attachment)
        assert result.state == State.TIMED_OUT and not waiter._pending

    asyncio.run(run())


def test_cancellation_during_publish_releases_registration(monkeypatch):
    async def run():
        waiter = ResultWaiter(timeout=1)
        instance, attachment, _ = processor(monkeypatch, waiter)
        entered = asyncio.Event()

        async def publish(*args, **kwargs):
            entered.set()
            await asyncio.Event().wait()

        monkeypatch.setattr(module, "publish_message", publish)
        task = asyncio.create_task(instance.process_attachment(3, attachment))
        await entered.wait()
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task
        assert not waiter._pending

    asyncio.run(run())
