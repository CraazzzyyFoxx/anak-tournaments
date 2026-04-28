from __future__ import annotations

from collections.abc import Awaitable, Callable
from typing import Any

from faststream.rabbit.fastapi import RabbitRouter
from loguru import logger
from redis import asyncio as redis_async
from shared.messaging.config import (
    TOURNAMENT_CHANGED_QUEUE,
    TOURNAMENT_RECALC_EXCHANGE,
    TOURNAMENT_RECALC_QUEUE,
)
from shared.observability import publish_message
from shared.schemas.events import TournamentChangedEvent, TournamentChangedReason, TournamentRecalcEvent
from sqlalchemy.ext.asyncio import AsyncSession

from src.core import config, db
from src.services.standings import service as standings_service
from src.services.standings import swiss_auto_round

PENDING_TTL_SECONDS = 15 * 60
PROCESSING_TTL_SECONDS = 15 * 60
DEDUPLICATION_HEADER = "x-deduplication-header"

task_router = RabbitRouter(config.settings.rabbitmq_url, logger=logger)

_redis_client: redis_async.Redis | None = None


def _pending_key(tournament_id: int) -> str:
    return f"tournament_recalc:pending:{tournament_id}"


def _processing_key(tournament_id: int) -> str:
    return f"tournament_recalc:processing:{tournament_id}"


def _dedupe_value(tournament_id: int) -> str:
    return f"tournament-recalc:{tournament_id}"


async def get_redis() -> redis_async.Redis:
    global _redis_client
    if _redis_client is None:
        _redis_client = redis_async.from_url(str(config.settings.redis_url), decode_responses=True)
    return _redis_client


async def close_redis() -> None:
    global _redis_client
    if _redis_client is None:
        return
    await _redis_client.aclose()
    _redis_client = None


async def _set_once(redis: Any, key: str, ttl_seconds: int) -> bool:
    return bool(await redis.set(key, "1", nx=True, ex=ttl_seconds))


async def enqueue_tournament_recalculation(
    tournament_id: int,
    *,
    broker: Any | None = None,
    redis: Any | None = None,
) -> bool:
    """Queue standings recalculation once while a tournament already has pending work."""
    redis_client = redis or await get_redis()
    pending_key = _pending_key(tournament_id)

    if not await _set_once(redis_client, pending_key, PENDING_TTL_SECONDS):
        logger.info("Tournament recalculation already pending", tournament_id=tournament_id)
        return False

    event = TournamentRecalcEvent(tournament_id=tournament_id)
    try:
        await publish_message(
            broker or task_router.broker,
            event.model_dump(),
            TOURNAMENT_RECALC_QUEUE,
            exchange=TOURNAMENT_RECALC_EXCHANGE,
            routing_key=f"tournament.recalc.{tournament_id}",
            headers={DEDUPLICATION_HEADER: _dedupe_value(tournament_id)},
            logger=logger.bind(tournament_id=tournament_id),
        )
    except Exception:
        await redis_client.delete(pending_key)
        raise

    return True


async def publish_tournament_changed(
    tournament_id: int,
    reason: TournamentChangedReason,
    *,
    broker: Any | None = None,
) -> None:
    event = TournamentChangedEvent(tournament_id=tournament_id, reason=reason)
    await publish_message(
        broker or task_router.broker,
        event.model_dump(),
        TOURNAMENT_CHANGED_QUEUE,
        exchange=TOURNAMENT_RECALC_EXCHANGE,
        routing_key=f"tournament.changed.{tournament_id}",
        headers={DEDUPLICATION_HEADER: f"tournament-changed:{tournament_id}:{reason}"},
        logger=logger.bind(tournament_id=tournament_id, reason=reason),
    )


async def process_tournament_recalculation_event(
    data: dict[str, Any],
    *,
    broker: Any | None = None,
    redis: Any | None = None,
    session_factory: Callable[[], Any] = db.async_session_maker,
    recalculate: Callable[[AsyncSession, int], Awaitable[Any]] = standings_service.recalculate_for_tournament,
) -> bool:
    """Handle one recalculation event.

    A short Redis processing lock makes duplicate deliveries/concurrent messages
    idempotent for the same tournament while the first recalculation is running.
    """
    event = TournamentRecalcEvent.model_validate(data)
    redis_client = redis or await get_redis()
    processing_key = _processing_key(event.tournament_id)

    if not await _set_once(redis_client, processing_key, PROCESSING_TTL_SECONDS):
        logger.info("Tournament recalculation already processing", tournament_id=event.tournament_id)
        return False

    completion_published = False
    try:
        async with session_factory() as session:
            await recalculate(session, event.tournament_id)

        async with session_factory() as session:
            await swiss_auto_round.enqueue_swiss_next_rounds(
                session,
                event.tournament_id,
                broker=broker or task_router.broker,
            )

        await publish_tournament_changed(
            event.tournament_id,
            "results_changed",
            broker=broker or task_router.broker,
        )
        completion_published = True
        return True
    finally:
        await redis_client.delete(processing_key)
        if completion_published:
            await redis_client.delete(_pending_key(event.tournament_id))
