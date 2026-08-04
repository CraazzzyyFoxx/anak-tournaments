"""APScheduler trigger for Subscription Collection.

Periodically checks subscriptions for active tournament participants.
Leader-locked across worker replicas via Redis.
"""

from __future__ import annotations

from typing import Any
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from loguru import logger

from shared.services import settings_provider
from shared.services.distributed_lock import (
    acquire_distributed_lock,
    release_distributed_lock,
)
from src.core import db
from src.core.config import settings
from . import service

SCHEDULER_TICK_SECONDS = 300
LEADER_LOCK_KEY = "subscription_collection:scheduler:leader"
LEADER_LOCK_TTL_SECONDS = SCHEDULER_TICK_SECONDS * 2

_scheduler: AsyncIOScheduler | None = None


async def run_subscription_collection_tick(
    session_factory: Any,
    redis_client: Any,
) -> int:
    """One scheduling pass: resolve subscriptions for active tournament participants."""
    token = await acquire_distributed_lock(
        redis_client, LEADER_LOCK_KEY, ttl_seconds=LEADER_LOCK_TTL_SECONDS
    )
    if token is None:
        logger.debug("Another replica holds the subscription collection leader lock; skipping tick")
        return 0

    try:
        async with session_factory() as session:
            cfg = await settings_provider.get_subscription_collection_config(session)
            if not cfg.enabled:
                logger.debug("Subscription collection disabled in settings; skipping tick")
                return 0

            count = await service.collect_subscriptions_for_active_tournaments(
                session,
                discord_bot_token=settings.discord_token,
                twitch_client_id=settings.twitch_client_id,
                proxy=settings.proxy_url,
            )
            logger.info("Subscription collection tick processed {} users", count)
            return count
    finally:
        await release_distributed_lock(redis_client, LEADER_LOCK_KEY, token)


def start_scheduler() -> None:
    global _scheduler
    if _scheduler is not None:
        return

    _scheduler = AsyncIOScheduler()
    _scheduler.add_job(
        run_subscription_collection_tick,
        "interval",
        args=[db.async_session_factory, db.redis_client],
        seconds=SCHEDULER_TICK_SECONDS,
        id="subscription_collection",
        max_instances=1,
        coalesce=True,
    )
    _scheduler.start()
    logger.info("Subscription collection scheduler started (tick={}s)", SCHEDULER_TICK_SECONDS)


def shutdown_scheduler() -> None:
    global _scheduler
    if _scheduler is None:
        return

    _scheduler.shutdown(wait=False)
    _scheduler = None
    logger.info("Subscription collection scheduler stopped")
