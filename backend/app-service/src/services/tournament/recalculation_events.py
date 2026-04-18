from __future__ import annotations

from typing import Any

from cashews import cache
from faststream.rabbit.fastapi import RabbitRouter
from loguru import logger
from shared.messaging.config import TOURNAMENT_RECALC_EXCHANGE, TOURNAMENT_RECALCULATED_QUEUE
from shared.observability import observe_message_processing
from shared.schemas.events import TournamentRecalculatedEvent

from src.core import config
from src.services.tournament.realtime import tournament_realtime_manager

task_router = RabbitRouter(config.settings.rabbitmq_url, logger=logger)


async def invalidate_tournament_standings_cache(tournament_id: int) -> None:
    patterns = (
        f"fastapi:*tournaments/{tournament_id}/standings*",
        f"backend:*tournaments/{tournament_id}/standings*",
        f"*tournaments/{tournament_id}/standings*",
    )
    for pattern in patterns:
        await cache.delete_match(pattern)


async def handle_tournament_recalculated_event(data: dict[str, Any]) -> None:
    event = TournamentRecalculatedEvent.model_validate(data)
    await invalidate_tournament_standings_cache(event.tournament_id)
    await tournament_realtime_manager.broadcast_recalculated(event.tournament_id)


@task_router.subscriber(TOURNAMENT_RECALCULATED_QUEUE, exchange=TOURNAMENT_RECALC_EXCHANGE)
async def process_tournament_recalculated(data: dict[str, Any], msg=None) -> None:
    async with observe_message_processing(
        queue=TOURNAMENT_RECALCULATED_QUEUE,
        handler="process_tournament_recalculated",
        message=msg,
        logger=logger,
    ):
        await handle_tournament_recalculated_event(data)
