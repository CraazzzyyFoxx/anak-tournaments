"""An upload names its Discord message; the verdict that comes back finds it by that name.

No replica waits for a result any more: stats echoes ``channel_id``/``message_id``
onto ``MatchLogProcessedEvent`` and whichever replica consumes ``match_log_result``
reacts on that message.
"""

import base64
import sys
from contextlib import asynccontextmanager
from pathlib import Path
from types import SimpleNamespace
from unittest import IsolatedAsyncioTestCase
from unittest.mock import AsyncMock, MagicMock, patch

import discord
import httpx

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from shared.domain.discord_ui import EMOJI  # noqa: E402
from src.feedback import AttachmentFeedbackState as State  # noqa: E402
from src.rabbit.gateway import DiscordRabbitGateway  # noqa: E402
from src.services import attachment_processor as module  # noqa: E402
from tests.gateway_fakes import message as delivery  # noqa: E402


def _processor(*bodies: bytes) -> tuple[module.AttachmentProcessor, SimpleNamespace]:
    responses = [
        httpx.Response(200, content=body, request=httpx.Request("GET", "https://x.test/log")) for body in bodies
    ]
    http = SimpleNamespace(get=AsyncMock(side_effect=responses))

    @asynccontextmanager
    async def client(**_kwargs):
        yield http

    return module.AttachmentProcessor(client=MagicMock(), attachment_clients=SimpleNamespace(create=client)), http


def _result_handler(processor: module.AttachmentProcessor):
    gateway = DiscordRabbitGateway(
        settings=MagicMock(),
        processor=processor,
        registry=MagicMock(),
        directory=MagicMock(),
        voice=MagicMock(),
        bot=MagicMock(wait_until_ready=AsyncMock()),
        session_maker=MagicMock(),
    )
    handlers = {}

    def subscriber(*_args, **_kwargs):
        def decorator(fn):
            handlers[fn.__name__] = fn
            return fn

        return decorator

    gateway._register(SimpleNamespace(subscriber=subscriber))
    return handlers["handle_match_log_result"]


def _verdict(status: str, *, job_id: int | None = 7, **ids: int | None) -> dict:
    return {
        "event_type": "match_log_processed",
        "tournament_id": 3,
        "filename": "match-1.log",
        "status": status,
        "ingest_job_id": job_id,
        "error_message": "bad bytes" if status != "done" else None,
        **ids,
    }


class UploadTests(IsolatedAsyncioTestCase):
    async def test_upload_event_names_its_message_and_returns_without_a_verdict(self) -> None:
        processor, http = _processor(b"log bytes")
        publish = AsyncMock()
        message = SimpleNamespace(id=55, channel=SimpleNamespace(id=44), author=SimpleNamespace(name="uploader"))
        attachment = SimpleNamespace(filename="match-1.log", url="https://x.test/log", content_type="text/plain")
        with (
            patch.object(module, "optional_broker", return_value=object()),
            patch.object(module, "publish_message", publish),
        ):
            result = await processor.process_attachment(3, message, attachment)

        self.assertIs(result.state, State.UPLOADED_QUEUED)
        payload = publish.await_args.args[1]
        self.assertEqual((payload["channel_id"], payload["message_id"]), (44, 55))
        self.assertEqual(payload["uploader_discord_name"], "uploader")
        self.assertEqual(base64.b64decode(payload["content_b64"]), b"log bytes")
        http.get.assert_awaited_once_with(attachment.url)


class ResultConsumerTests(IsolatedAsyncioTestCase):
    def _fixture(self, fetched: object):
        processor, _ = _processor()
        channel = MagicMock(fetch_message=AsyncMock(side_effect=[fetched]))
        processor.get_text_channel = AsyncMock(return_value=channel)
        return _result_handler(processor), channel

    async def test_a_verdict_only_adds_to_the_message_it_names(self) -> None:
        """A problem adds ``warn`` beside ``ok`` and replies; a success adds ``ok`` and says nothing.

        Nothing is ever removed: a sibling file's success must not take back this file's ``warn``.
        """
        target = MagicMock(id=55, add_reaction=AsyncMock(), remove_reaction=AsyncMock(), reply=AsyncMock())
        handle, channel = self._fixture(target)

        msg = delivery()
        await handle(_verdict("failed", channel_id=44, message_id=55), msg)

        channel.fetch_message.assert_awaited_once_with(55)
        self.assertEqual({call.args[0] for call in target.add_reaction.await_args_list}, {EMOJI["ok"], EMOJI["warn"]})
        self.assertIn("bad bytes", target.reply.await_args.args[0])
        target.remove_reaction.assert_not_awaited()
        msg.reject.assert_not_awaited()

        target.reset_mock()
        channel.fetch_message.side_effect = [target]
        await handle(_verdict("done", channel_id=44, message_id=55), delivery())
        self.assertEqual([call.args[0] for call in target.add_reaction.await_args_list], [EMOJI["ok"]])
        target.reply.assert_not_awaited()
        target.remove_reaction.assert_not_awaited()

    async def test_a_verdict_with_nowhere_to_land_is_acked(self) -> None:
        handle, channel = self._fixture(discord.NotFound(MagicMock(status=404), "gone"))

        unnamed, gone = delivery(), delivery()
        await handle(_verdict("done"), unnamed)
        channel.fetch_message.assert_not_awaited()
        await handle(_verdict("done", channel_id=44, message_id=55), gone)

        for msg in (unnamed, gone):
            msg.reject.assert_not_awaited()
            msg.nack.assert_not_awaited()
