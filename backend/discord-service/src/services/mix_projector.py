"""A mix's live Discord cards as a projection of ``pickup_mix.changed``.

No mutation knows about Discord: a mix write emits the fact
(``shared.services.pickup_mix_realtime.emit_pickup_mix_changed``), the outbox hands it to
``pickup_mix_changed``, and this consumer re-renders every live card the fact
affects from the mix as it stands NOW (:func:`src.render.render`). A
redelivered, late or duplicated event is therefore harmless -- it renders the
same state twice, and a render equal to the row's ``card_json`` touches nothing.

Two kinds of card follow a mix. The signup card: an event naming one mix
touches that mix's newest live card (an older live row is only ever on its way
out); an event with no mix -- a renamed player, a corrected rank -- touches the
newest live card of every mix in the workspace, because every one of them
shows that name. The lineup cards: every live one of the named mix, because a
lineup shows the names and ratings its balance stored, not the live roster;
one whose match is played stays as it was (:data:`src.render.KEEP`).

Edits coalesce per ``discord_message`` row: a burst of Join clicks becomes one
Discord call 2 s after the first, showing the render made at flush time -- so
the order RabbitMQ delivered the events in cannot matter.
"""

from __future__ import annotations

import asyncio
from collections.abc import Callable
from typing import Any

import discord
from faststream.rabbit import Channel
from faststream.rabbit.annotations import RabbitMessage
from loguru import logger
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from shared.messaging.config import PICKUP_MIX_CHANGED_QUEUE
from shared.observability import observe_message_processing
from shared.repository.discord_message import LIVE_STATUSES, DiscordMessageRepository
from shared.schemas.events import PickupMixChangedEvent
from shared.services.discord_messages import SIGNUP_SLOT, emit_changed, mix_subject
from src.interactions.cards import card_view
from src.render import Rendered, render

__all__ = ("EDIT_COALESCE_SECONDS", "EDIT_PENDING_ATTEMPTS", "MixProjector")

#: How long an edit of one message waits for a newer one to replace it. The
#: live signup post is re-rendered on every join/leave click, so a burst of
#: clicks becomes one Discord call instead of one per click.
EDIT_COALESCE_SECONDS = 2.0

#: How many of those windows an edit waits out while its message is still
#: ``pending``: the gateway is sending it, and the send renders the mix as it
#: stood then. After that the edit is dropped -- the next change re-renders
#: the whole card anyway.
EDIT_PENDING_ATTEMPTS = 5


class MixProjector:
    """Keeps every live mix card in step with its mix."""

    def __init__(
        self,
        *,
        bot: discord.Client,
        session_maker: async_sessionmaker[AsyncSession],
        messages: DiscordMessageRepository = DiscordMessageRepository(),
        renderer: Callable[..., Any] = render,
    ) -> None:
        self._bot = bot
        self._session_maker = session_maker
        self._messages = messages
        self._render = renderer
        self._broker: Any = None
        # Rows with a re-render owed, and the task that will write it.
        # ponytail: process memory, like every other window in this service
        # (single replica). A crash loses the edits owed; the next change
        # re-renders the whole card, so nothing drifts permanently.
        self._pending: set[int] = set()
        self._tasks: dict[int, asyncio.Task[None]] = {}

    def register(self, broker: Any) -> None:
        self._broker = broker

        # Its own channel: a workspace-wide event re-renders one card per mix,
        # which must not eat the RPC queues' QoS window. `msg` MUST be
        # annotated RabbitMessage -- with a looser annotation FastStream takes
        # it for another payload field and every message fails validation.
        @broker.subscriber(PICKUP_MIX_CHANGED_QUEUE, channel=Channel(prefetch_count=4))
        async def project_mix_cards(body: dict[str, Any], msg: RabbitMessage) -> None:
            async with observe_message_processing(
                queue=PICKUP_MIX_CHANGED_QUEUE,
                handler="project_mix_cards",
                message=msg,
                logger=logger,
            ):
                event = PickupMixChangedEvent.model_validate(body)
                async with self._session_maker() as session:
                    targets = await self._targets(session, event)
                for row_id in targets:
                    self.schedule(row_id)

    async def _targets(self, session: AsyncSession, event: PickupMixChangedEvent) -> list[int]:
        """The live rows this event re-renders: the newest signup card per mix, and the mix's lineups."""
        if event.custom_game_id is None:
            rows = await self._messages.live_for_workspace(
                session, event.workspace_id, subject_prefix="mix:", slot=SIGNUP_SLOT
            )
            # Oldest first, so the last row of each subject is that mix's current card.
            return [row.id for row in {row.subject: row for row in rows}.values()]
        rows = await self._messages.for_subject(session, mix_subject(event.custom_game_id), statuses=LIVE_STATUSES)
        signups = [row.id for row in rows if row.slot == SIGNUP_SLOT][-1:]
        return signups + [row.id for row in rows if row.slot.startswith("lineup:")]

    def schedule(self, row_id: int) -> None:
        """Note that this row owes a re-render; the flush renders the mix as it is by then."""
        self._pending.add(row_id)
        if row_id not in self._tasks:
            self._tasks[row_id] = asyncio.create_task(self._flush(row_id))

    def close(self) -> None:
        # Cleared first, or a cancelled flush would reschedule itself on the way out.
        self._pending.clear()
        for task in list(self._tasks.values()):
            task.cancel()

    async def _flush(self, row_id: int) -> None:
        """After the coalescing window, re-render the row; a ``pending`` one is waited out a few windows."""
        try:
            for _attempt in range(EDIT_PENDING_ATTEMPTS):
                await asyncio.sleep(EDIT_COALESCE_SECONDS)
                # Every ping up to here is covered by the render below.
                self._pending.discard(row_id)
                if await self._refresh(row_id):
                    return
            logger.warning(f"⚠️ discord_message {row_id} is still not posted; dropping its re-render")
        except Exception as exc:
            # Nobody awaits this task: an outage (database, balancer-service)
            # costs this edit only, and the next change renders the card again.
            logger.error(f"❌ Could not re-render discord_message {row_id}: {exc!r}")
        finally:
            self._tasks.pop(row_id, None)
            if row_id in self._pending:
                # A ping landed while this flush was writing: nothing else would
                # pick it up, and the live post would stay a seat behind.
                self.schedule(row_id)

    async def _refresh(self, row_id: int) -> bool:
        """Show the row's current render; ``False`` while its own send is still on its way."""
        async with self._session_maker() as session:
            # Locked: serializes everyone re-rendering this message, and a
            # delete queued meanwhile waits for this edit to be recorded.
            row = await self._messages.get_for_update(session, row_id)
            if row is None:
                logger.error(f"❌ discord_message {row_id} is gone; dropping its re-render")
                return True
            if row.status == "pending":
                return False
            if row.status != "posted":
                logger.info(f"ℹ️ discord_message {row_id} is {row.status}; dropping its re-render")
                return True

            rendered = await self._render(session, row, broker=self._broker)
            if not isinstance(rendered, Rendered):
                return True  # history (KEEP) or a mix that is gone: the message stays as it is
            card_json = rendered.card.model_dump(mode="json")
            if card_json == row.card_json:
                return True

            extra: dict[str, Any] = {}
            if rendered.file is not None:
                extra["attachments"] = [rendered.file]
            elif rendered.card.attachment_name is None:
                # A card that became text drops the picture it was showing.
                extra["attachments"] = []
            try:
                # No fetch: the ids are enough to edit. A DM channel answers an
                # edit exactly like a guild one.
                await (
                    self._bot.get_partial_messageable(row.discord_channel_id)
                    .get_partial_message(row.message_id)
                    .edit(view=card_view(rendered.card), allowed_mentions=discord.AllowedMentions.none(), **extra)
                )
            except discord.NotFound:
                logger.warning(f"⚠️ Message {row.message_id} is gone; closing discord_message {row.id}")
                await self._messages.mark_deleted(session, row.id)
                await emit_changed(session, row)
                await session.commit()
                return True
            except discord.HTTPException as exc:
                # Left unrecorded: the next change tries again with a fresh render.
                logger.error(f"❌ Discord refused the edit of message {row.message_id}: HTTP {exc.status}: {exc.text}")
                return True
            await self._messages.set_card(session, row.id, card_json)
            await session.commit()
            return True
