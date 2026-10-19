"""Admin service for per-tournament Discord channel config CRUD.

Replaces the inline ``select``/``session.add``/``delete(...)`` that used to
live directly in ``rpc/misc.py`` — the clearest ``ARCHITECTURE.md`` violation
in this service (see
``docs/plans/2026-08-21-stats-service-oop-repositories.md`` §2.4).
"""

from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncSession

from shared.messaging.config import TOURNAMENT_DISCORD_CHANNEL_CHANGED_ROUTING_KEY, TOURNAMENT_EVENTS_EXCHANGE
from shared.messaging.outbox import enqueue_outbox_event
from shared.repository import DiscordChannelRepository
from shared.schemas.events import DiscordChannelChangedEvent
from src import models

__all__ = ("DiscordChannelService", "discord_channel_service")


class DiscordChannelService:
    def __init__(self, *, repo: DiscordChannelRepository = DiscordChannelRepository()) -> None:
        self.repo = repo

    async def get(self, session: AsyncSession, tournament_id: int) -> models.TournamentDiscordChannel | None:
        return await self.repo.get_by_tournament(session, tournament_id)

    async def upsert(
        self,
        session: AsyncSession,
        tournament_id: int,
        *,
        channel_id: int,
        channel_name: str | None,
        is_active: bool,
    ) -> models.TournamentDiscordChannel:
        channel = await self.repo.get_by_tournament(session, tournament_id)
        fields = {"channel_id": channel_id, "channel_name": channel_name, "is_active": is_active}
        if channel is None:
            # Every NOT NULL column is set on the instance before it is ever
            # flushed (`repo.create` flushes immediately) — an empty-then-
            # populated instance would violate `channel_id`'s NOT NULL
            # constraint at flush time.
            channel = await self.repo.create(
                session, models.TournamentDiscordChannel(tournament_id=tournament_id, **fields)
            )
        else:
            channel = await self.repo.update_fields(session, channel, fields)
        await _enqueue_changed(session, tournament_id)
        await session.commit()
        await session.refresh(channel)
        return channel

    async def delete(self, session: AsyncSession, tournament_id: int) -> bool:
        channel = await self.repo.get_by_tournament(session, tournament_id)
        if channel is None:
            return False
        await self.repo.delete(session, channel)
        await _enqueue_changed(session, tournament_id)
        await session.commit()
        return True


async def _enqueue_changed(session: AsyncSession, tournament_id: int) -> None:
    # The bot's channel registry reloads its watched-channel set on this, committed with the binding itself.
    await enqueue_outbox_event(
        session,
        DiscordChannelChangedEvent(tournament_id=tournament_id, source_service="stats-service"),
        exchange=TOURNAMENT_EVENTS_EXCHANGE,
        routing_key=TOURNAMENT_DISCORD_CHANNEL_CHANGED_ROUTING_KEY,
    )


discord_channel_service = DiscordChannelService()
