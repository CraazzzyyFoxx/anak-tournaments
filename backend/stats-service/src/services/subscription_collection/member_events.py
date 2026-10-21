"""Instant Boosty re-check when a Discord guild member joins, leaves or has their roles changed.

``DiscordMemberChangedEvent`` comes straight from the bot's gateway event. The verdict is recomputed from the live
roles, so a redelivered or duplicated event resolves the same thing again; the scheduled collection sweep stays the
slow reconciliation for whatever this misses. A failure dead-letters: the next role change or sweep catches up.
"""

from __future__ import annotations

from typing import Any

from faststream.rabbit import Channel
from faststream.rabbit.annotations import RabbitMessage

from shared.core.enums import SubscriptionCollectionSource
from shared.core.social import SocialProvider
from shared.messaging.config import DISCORD_MEMBER_CHANGED_QUEUE
from shared.observability import observe_message_processing
from shared.repository import OAuthConnectionRepository, WorkspaceRepository
from shared.schemas.events import DiscordMemberChangedEvent
from shared.services.subscriptions.wiring import build_resolver
from src.core import db

__all__ = ("register", "resync")

# Its own channel: a resolve can wait on the bot's role RPC, which must not hold the jobs channel's slots.
_MEMBER_CHANNEL = Channel(prefetch_count=2)

_workspaces = WorkspaceRepository()
_oauth_connections = OAuthConnectionRepository()


async def resync(session: Any, event: DiscordMemberChangedEvent, *, broker: Any) -> list[int]:
    """Re-resolve the member's Boosty entitlement in every workspace bound to the guild; returns those workspaces."""
    workspace_ids = list(await _workspaces.list_ids_by_discord_guild(session, event.guild_id))
    if not workspace_ids:
        return []
    connection = await _oauth_connections.get_by_provider_subject(
        session, provider=SocialProvider.DISCORD, provider_user_id=event.discord_user_id
    )
    if connection is None:
        return []
    # Boosty is the only provider re-resolved here; it asks the bot (discord_member_roles RPC), so only the broker matters.
    resolver = build_resolver(session, broker=broker)
    for workspace_id in workspace_ids:
        await resolver.resolve(
            workspace_id=workspace_id,
            auth_user_ids=[connection.auth_user_id],
            providers=[SocialProvider.BOOSTY],
            force_refresh=True,
            source=SubscriptionCollectionSource.scheduled,
        )
    await session.commit()
    return workspace_ids


def register(broker: Any, logger: Any) -> None:
    # ponytail: no burst coalescing, one resolve per gateway event; add a per-(guild, user) debounce if role churn
    # floods this queue.
    @broker.subscriber(DISCORD_MEMBER_CHANGED_QUEUE, channel=_MEMBER_CHANNEL)
    async def discord_member_changed(data: dict[str, Any], msg: RabbitMessage) -> None:
        async with observe_message_processing(
            queue=DISCORD_MEMBER_CHANGED_QUEUE,
            handler="discord_member_changed",
            message=msg,
            logger=logger,
        ) as context:
            event = DiscordMemberChangedEvent.model_validate(data)
            async with db.async_session_maker() as session:
                workspace_ids = await resync(session, event, broker=broker)
            context.logger.bind(reason=event.reason, workspace_ids=workspace_ids).info("Discord member re-resolved")
