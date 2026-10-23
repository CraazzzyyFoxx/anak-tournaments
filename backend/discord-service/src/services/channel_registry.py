"""In-memory cache of Discord channels currently monitored for match-log uploads.

Backed by ``TournamentDiscordChannel`` via the repository; reloaded whenever a
tournament's state changes (``DiscordRabbitGateway``), after a binding is
written through ``rpc.discord.channel.*`` (``src.rpc_api``), and hourly as a
fallback, so a channel starts/stops being watched without a restart.

Each channel also carries its rescan cursor -- the newest message the bot has
already walked past -- so a reconnect reads what it missed, not the last 500
messages again.
"""

from __future__ import annotations

import asyncio
from datetime import UTC, datetime, timedelta

from loguru import logger
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from shared.repository import DiscordChannelRepository

# A tournament stays watched for this long after it finishes so a late log
# upload still lands somewhere.
_FINISHED_GRACE_PERIOD = timedelta(days=1)


class ChannelRegistry:
    def __init__(
        self,
        *,
        session_maker: async_sessionmaker[AsyncSession],
        channels: DiscordChannelRepository = DiscordChannelRepository(),
    ) -> None:
        self._session_maker = session_maker
        self._channels = channels
        self._active: dict[int, int] = {}
        self._cursors: dict[int, int] = {}
        self._reload_lock = asyncio.Lock()

    def tournament_id_for(self, channel_id: int) -> int | None:
        """The tournament this channel is currently monitored for, if any."""
        return self._active.get(channel_id)

    def channel_ids(self) -> dict[int, int]:
        """Snapshot of the active set as ``channel_id -> tournament_id``."""
        return dict(self._active)

    def cursor_for(self, channel_id: int) -> int | None:
        """The newest message already scanned in this channel; ``None`` when it never was."""
        return self._cursors.get(channel_id)

    async def advance(self, channel_id: int, message_id: int) -> None:
        """Move the channel's cursor up to ``message_id`` (never back), in memory and in the row."""
        if message_id <= self._cursors.get(channel_id, 0):
            return
        self._cursors[channel_id] = message_id
        async with self._session_maker() as session:
            await self._channels.set_last_scanned(session, channel_id, message_id)
            await session.commit()

    async def reload(self) -> None:
        """Reload the active-channel set from the database.

        One at a time: a burst of change events queues reloads behind the one
        running, so the last to finish has read the latest committed state.
        """
        async with self._reload_lock:
            finished_cutoff = datetime.now(UTC) - _FINISHED_GRACE_PERIOD
            async with self._session_maker() as session:
                rows = await self._channels.list_active_with_tournament(session, finished_cutoff=finished_cutoff)

            new_active: dict[int, int] = {}
            new_cursors: dict[int, int] = {}
            for discord_channel, tournament in rows:
                new_active[discord_channel.channel_id] = tournament.id
                if discord_channel.last_scanned_message_id is not None:
                    new_cursors[discord_channel.channel_id] = discord_channel.last_scanned_message_id
                logger.info(f"📌 Monitoring channel {discord_channel.channel_id} for tournament {tournament.name}")

            self._active = new_active
            self._cursors = new_cursors
            logger.success(f"✅ Loaded {len(self._active)} active channels")
