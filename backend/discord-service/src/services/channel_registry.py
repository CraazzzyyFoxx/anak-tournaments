"""In-memory cache of Discord channels currently monitored for match-log uploads.

Backed by ``TournamentDiscordChannel`` via the repository; reloaded periodically
so a tournament's channel starts/stops being watched without a bot restart.
"""

from __future__ import annotations

from collections.abc import Sequence
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

    def tournament_id_for(self, channel_id: int) -> int | None:
        """The tournament this channel is currently monitored for, if any."""
        return self._active.get(channel_id)

    def channel_ids(self) -> dict[int, int]:
        """Snapshot of the active set as ``channel_id -> tournament_id``."""
        return dict(self._active)

    async def reload(self) -> None:
        """Reload the active-channel set from the database."""
        finished_cutoff = datetime.now(UTC) - _FINISHED_GRACE_PERIOD
        async with self._session_maker() as session:
            rows = await self._channels.list_active_with_tournament(session, finished_cutoff=finished_cutoff)

        new_active: dict[int, int] = {}
        for discord_channel, tournament in rows:
            new_active[discord_channel.channel_id] = tournament.id
            logger.info(f"📌 Monitoring channel {discord_channel.channel_id} for tournament {tournament.name}")

        self._active = new_active
        logger.success(f"✅ Loaded {len(self._active)} active channels")

    async def list_channel_ids_for_tournament(self, tournament_id: int) -> Sequence[int]:
        """Fresh (uncached) lookup of a tournament's active channel ids.

        Used by the ``process_all`` RabbitMQ command, which must see the
        authoritative database state rather than whatever the periodic reload
        last cached.
        """
        async with self._session_maker() as session:
            return await self._channels.list_channel_ids_for_tournament(session, tournament_id)
