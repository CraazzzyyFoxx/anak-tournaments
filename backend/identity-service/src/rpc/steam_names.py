"""``SteamAccountChangedEvent`` (any social-account writer -> identity): fetch the account's persona name.

``shared.services.social_identity`` stages the event in the same transaction
that creates a Steam ``social_account`` or changes its account id; this writes
the persona name into ``display_name``. Best effort: a Steam / deadlock-api
failure leaves the name for the daily refresh (``serve.py``). Re-fetching is
idempotent, so a redelivery is harmless; a payload that does not validate
raises and dead-letters.
"""

from __future__ import annotations

from typing import Any

from faststream.rabbit import Channel, RabbitMessage

from shared.messaging.config import STEAM_ACCOUNT_CHANGED_QUEUE
from shared.observability import observe_message_processing
from shared.schemas.events import SteamAccountChangedEvent
from src.core import db
from src.services.oauth_providers import oauth_providers
from src.services.steam_profiles import refresh_display_names

# Own channel: a burst of imported Steam accounts must not take the RPC QoS slots.
_CHANNEL = Channel(prefetch_count=4)


def register(broker: Any, logger: Any) -> None:
    @broker.subscriber(STEAM_ACCOUNT_CHANGED_QUEUE, channel=_CHANNEL)
    async def _steam_account_changed(data: dict, msg: RabbitMessage) -> None:
        async with observe_message_processing(
            queue=STEAM_ACCOUNT_CHANGED_QUEUE,
            handler="steam_account_changed",
            message=msg,
            logger=logger,
        ):
            event = SteamAccountChangedEvent.model_validate(data)
            async with db.async_session_maker() as session:
                await refresh_display_names(
                    session, oauth_providers.http.client(), account_ids=[event.social_account_id]
                )
                await session.commit()
