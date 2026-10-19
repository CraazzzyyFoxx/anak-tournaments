"""Downloads Discord log-file attachments, hands them to stats-service over
RabbitMQ, and reflects the outcome back onto the originating message via
reactions/replies: the hand-off at once, stats's per-file verdict whenever its
``match_log_result`` names this message (:meth:`AttachmentProcessor.apply_result`).
"""

from __future__ import annotations

import asyncio
import base64

import discord
import httpx
from loguru import logger

from shared.domain.discord_ui import EMOJI
from shared.messaging.config import UPLOAD_MATCH_LOG_QUEUE
from shared.observability import publish_message
from shared.schemas.events import MatchLogProcessedEvent, UploadMatchLogEvent
from src.core.broker import optional_broker
from src.feedback import (
    AttachmentFeedbackResult,
    AttachmentFeedbackState,
    build_message_feedback,
    upload_reactions,
)
from src.interactions.emoji import registry
from src.services.attachment_client import AttachmentClientFactory

_LOG_FILE_SUFFIXES = (".txt", ".log", ".json")

#: The three verdicts a log message can carry, as emoji names.
_FEEDBACK_STATES = ("ok", "warn", "error")

#: What the bot reacted with before any of this: ``❌`` is not the current
#: Unicode fallback for ``error`` (``⛔`` is), but it still sits on every
#: message processed by the older bot.
_LEGACY_REACTIONS = frozenset({"✅", "⚠️", "❌"})


class AttachmentProcessor:
    """Owns the log-upload pipeline and the per-message in-flight processing guard."""

    def __init__(self, *, client: discord.Client, attachment_clients: AttachmentClientFactory) -> None:
        self._client = client
        self._attachment_clients = attachment_clients
        self._processing_messages: set[int] = set()

    async def get_text_channel(self, channel_id: int) -> discord.abc.Messageable | None:
        channel = self._client.get_channel(channel_id)
        if channel is None:
            try:
                channel = await self._client.fetch_channel(channel_id)
            except (discord.NotFound, discord.Forbidden):
                return None
        return channel if isinstance(channel, discord.abc.Messageable) else None

    async def process_attachment(
        self, tournament_id: int, message: discord.Message, attachment: discord.Attachment
    ) -> AttachmentFeedbackResult:
        """Download one attachment and hand it to stats-service; ``UPLOADED_QUEUED`` once it is out.

        The event names ``message``, and stats echoes that back on its result, so
        whichever replica consumes the verdict knows where to put it.
        """
        try:
            logger.info(f"📥 Downloading {attachment.filename} for tournament {tournament_id}")
            async with self._attachment_clients.create() as http_client:
                # Download file from Discord
                response = await http_client.get(attachment.url)
                response.raise_for_status()

            # Hash identity is decided from the downloaded bytes by stats-service;
            # a display filename is never proof that an upload was processed.
            broker = optional_broker()
            if broker is None:
                logger.warning(f"⚠️ RabbitMQ not available, cannot upload {attachment.filename}")
                return AttachmentFeedbackResult(
                    filename=attachment.filename,
                    state=AttachmentFeedbackState.UPLOAD_FAILED,
                    error_message="RabbitMQ unavailable",
                )

            event = UploadMatchLogEvent(
                tournament_id=tournament_id,
                filename=attachment.filename,
                content_b64=base64.b64encode(response.content).decode("ascii"),
                content_type=attachment.content_type,
                uploader_discord_name=message.author.name,
                channel_id=message.channel.id,
                message_id=message.id,
            )
            event.correlation_id = event.event_id
            await publish_message(
                broker,
                event.model_dump(),
                UPLOAD_MATCH_LOG_QUEUE,
                logger=logger.bind(tournament_id=tournament_id, filename=attachment.filename),
                correlation_id=event.event_id,
            )
            return AttachmentFeedbackResult(
                filename=attachment.filename,
                state=AttachmentFeedbackState.UPLOADED_QUEUED,
            )

        except httpx.HTTPError as e:
            logger.error(f"❌ HTTP error processing {attachment.filename}: {e}")
            return AttachmentFeedbackResult(
                filename=attachment.filename,
                state=AttachmentFeedbackState.UPLOAD_FAILED,
                error_message=str(e),
            )
        except Exception as e:
            logger.error(f"❌ Unexpected error processing {attachment.filename}: {e}")
            return AttachmentFeedbackResult(
                filename=attachment.filename,
                state=AttachmentFeedbackState.UPLOAD_FAILED,
                error_message=str(e),
            )

    def _resolved_reaction(self, name: str) -> discord.Emoji | str:
        """The uploaded emoji for ``name``, its Unicode fallback until there is one."""
        return registry.component(name) or EMOJI[name]

    async def _apply_message_reactions(self, message: discord.Message, reactions: tuple[str, ...]) -> None:
        """Reconcile the bot's own reactions on ``message`` to exactly ``reactions`` (emoji names)."""
        wanted = [self._resolved_reaction(name) for name in reactions]
        keep = {str(item) for item in wanted}
        # Everything this message could be carrying from the bot: today's emoji
        # for each state, plus every character it reacted with before -- a
        # re-processed message still shows the Unicode ✅/⚠️/❌ of the old bot,
        # and leaving those beside the uploaded ones reads as two verdicts.
        ours = {str(self._resolved_reaction(name)) for name in _FEEDBACK_STATES}
        ours |= {EMOJI[name] for name in _FEEDBACK_STATES} | _LEGACY_REACTIONS
        stale = [
            reaction.emoji
            for reaction in message.reactions
            if reaction.me and str(reaction.emoji) in ours and str(reaction.emoji) not in keep
        ]

        async def _remove(emoji: discord.Emoji | discord.PartialEmoji | str) -> None:
            try:
                await message.remove_reaction(emoji, self._client.user)
            except discord.NotFound:
                pass

        # Independent per-emoji REST calls: run them concurrently instead of
        # paying up to three sequential round trips before the reply goes out.
        await asyncio.gather(
            *(message.add_reaction(item) for item in wanted),
            *(_remove(item) for item in stale),
        )

    @staticmethod
    async def _send_feedback_reply(message: discord.Message, reply_text: str) -> None:
        await message.reply(registry.render(reply_text), mention_author=False)

    async def apply_result(self, message: discord.Message, event: MatchLogProcessedEvent) -> None:
        """Put stats-service's verdict for one file on the message it came from.

        Only ever adds: a message carrying several logs gets one verdict per
        file, in any order, and a later success must not take back an earlier
        file's ``warn``. Adding a reaction the bot already has changes nothing.
        """
        if event.status == "done":
            state = AttachmentFeedbackState.PROCESSED_OK
        elif event.status == "awaiting_link":
            state = AttachmentFeedbackState.AWAITING_LINK
        elif event.ingest_job_id is None:
            state = AttachmentFeedbackState.UPLOAD_FAILED
        else:
            state = AttachmentFeedbackState.PROCESSED_FAILED
        summary = build_message_feedback(
            AttachmentFeedbackResult(filename=event.filename, state=state, error_message=event.error_message)
        )

        try:
            await asyncio.gather(*(message.add_reaction(self._resolved_reaction(name)) for name in summary.reactions))
        except discord.HTTPException as e:
            logger.warning(f"⚠️ Failed to react on message {message.id}: {e}")

        if summary.reply_text is not None:
            try:
                await self._send_feedback_reply(message, summary.reply_text)
            except discord.HTTPException as e:
                logger.warning(f"⚠️ Failed to reply on message {message.id}: {e}")

    async def process_message(self, message: discord.Message, tournament_id: int) -> None:
        """Hand every log file on ``message`` to stats-service and mark the hand-off.

        Returns once the files are published; nothing waits for stats. Its
        per-file verdict arrives later on ``match_log_result`` (:meth:`apply_result`).
        """
        if message.id in self._processing_messages:
            return  # Already processing

        if not message.attachments:
            return  # No attachments to process

        self._processing_messages.add(message.id)

        try:
            results: list[AttachmentFeedbackResult] = []
            for attachment in message.attachments:
                # Only process log files
                if attachment.filename.lower().endswith(_LOG_FILE_SUFFIXES):
                    results.append(await self.process_attachment(tournament_id, message, attachment))
                else:
                    logger.info(f"⏭️ Skipping non-log file: {attachment.filename}")

            if not results:
                return

            # ponytail: a verdict that lands before this reconcile (a pre-job failure
            # while later files still download) loses its ``warn`` here; its reply
            # stays. Reconcile before publishing if that ever shows up in practice.
            try:
                await self._apply_message_reactions(message, upload_reactions(results))
            except discord.Forbidden:
                logger.warning("⚠️ Bot doesn't have permission to add reactions")
            except discord.HTTPException as e:
                logger.warning(f"⚠️ Failed to add reaction: {e}")

        finally:
            self._processing_messages.discard(message.id)

    async def process_channel_history(self, channel_id: int, tournament_id: int, *, limit: int = 10) -> None:
        """
        Process recent message history in a channel.
        Used when the bot starts or a channel is newly added.
        """
        try:
            channel = await self.get_text_channel(channel_id)
            if not channel:
                logger.error(f"❌ Channel {channel_id} not found")
                return

            logger.info(f"🔍 Processing last {limit} messages in channel {channel_id}")

            processed = 0
            async for message in channel.history(limit=limit):
                if message.attachments:
                    await self.process_message(message, tournament_id)
                    processed += 1

            logger.success(f"✅ Processed {processed} messages with attachments")

        except discord.Forbidden:
            logger.error(f"❌ No permission to read channel {channel_id}")
        except Exception as e:
            logger.error(f"❌ Error processing channel history: {e}")
