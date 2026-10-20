"""Consumer of ``WorkspaceMemberChangedEvent`` (app-service -> identity).

app-service stages the event in the same transaction as a workspace membership
or role write (and a profile merge); this drops the cached RBAC payload of every
listed user, so their next request re-resolves from the database. Dropping a key
that is already gone is a no-op, so a redelivery is harmless. A payload that does
not validate raises and dead-letters.
"""

from __future__ import annotations

from typing import Any

from faststream.rabbit import Channel, RabbitMessage

from shared.messaging.config import WORKSPACE_MEMBER_CHANGED_QUEUE
from shared.observability import observe_message_processing
from shared.schemas.events import WorkspaceMemberChangedEvent
from src.services.session_cache import session_cache

# Own channel: a burst of membership changes must not take the RPC QoS slots.
_CHANNEL = Channel(prefetch_count=4)


def register(broker: Any, logger: Any) -> None:
    @broker.subscriber(WORKSPACE_MEMBER_CHANGED_QUEUE, channel=_CHANNEL)
    async def _workspace_member_changed(data: dict, msg: RabbitMessage) -> None:
        async with observe_message_processing(
            queue=WORKSPACE_MEMBER_CHANGED_QUEUE,
            handler="workspace_member_changed",
            message=msg,
            logger=logger,
        ) as context:
            event = WorkspaceMemberChangedEvent.model_validate(data)
            for user_id in event.auth_user_ids:
                await session_cache.invalidate_rbac(user_id)
            context.logger.info(
                "Workspace {} membership {}: RBAC cache dropped for users {}",
                event.workspace_id,
                event.change,
                event.auth_user_ids,
            )
