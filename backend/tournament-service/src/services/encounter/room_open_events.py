"""The tournament consumer of ``tournament.encounter.pick_ban_room_open_requested`` (spec §5.1 step 5).

balancer-service's Start match stages the request in the transaction that started a mix match with hero bans. This
handler runs the room healer on that encounter, which opens the room once its gates are open (both seats ready, a
config). The healer is idempotent, so a redelivery changes nothing; a failure propagates to
``tournament_pick_ban_room_open.dlq``.
"""

from __future__ import annotations

from typing import Any

from faststream.rabbit import RabbitRouter
from faststream.rabbit.annotations import RabbitMessage
from loguru import logger

from shared.messaging.config import TOURNAMENT_EVENTS_EXCHANGE, TOURNAMENT_PICK_BAN_ROOM_OPEN_QUEUE
from shared.observability import observe_message_processing
from shared.schemas.events import PickBanRoomOpenRequestedEvent
from src.core import db
from src.services.encounter.room_reconcile import reconcile_encounter

__all__ = ("process_room_open", "task_router")

task_router = RabbitRouter()


async def process_room_open(data: dict[str, Any]) -> bool:
    """Heal one room; whether anything changed. A missing or finished encounter changes nothing."""
    event = PickBanRoomOpenRequestedEvent.model_validate(data)
    async with db.async_session_maker() as session:
        return await reconcile_encounter(session, event.encounter_id)


@task_router.subscriber(TOURNAMENT_PICK_BAN_ROOM_OPEN_QUEUE, exchange=TOURNAMENT_EVENTS_EXCHANGE)
async def consume_room_open(data: dict[str, Any], msg: RabbitMessage) -> None:
    async with observe_message_processing(
        queue=TOURNAMENT_PICK_BAN_ROOM_OPEN_QUEUE,
        handler="consume_room_open",
        message=msg,
        logger=logger,
    ) as context:
        opened = await process_room_open(data)
        context.logger.bind(opened=opened).info("Pick-ban room open handled")
