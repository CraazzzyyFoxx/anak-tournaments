"""Worker lifecycle of the OverFast rank collector: consumers, schedules, the OverFast client.

The registry's lazy wrappers (``shared.disciplines.overwatch``) call these; a worker that does not select Overwatch
never imports this module.

Topology: the scheduler publishes one ``FetchRankEvent`` per due battle tag; the consumers perform the HTTP call.
The rank-fetch queues get their own channel prefetch (OverFast-protective); the registration consumers ride the broker's
default channel. Their dead-letter queues are declared by the worker (``serve._OWNED_DLQS``).
"""

from collections.abc import Awaitable
from typing import Any

from faststream.rabbit import Channel
from faststream.rabbit.annotations import RabbitMessage

from shared.messaging.config import (
    RANK_FETCH_PRIORITY_QUEUE,
    RANK_FETCH_QUEUE,
    TOURNAMENT_EVENTS_EXCHANGE,
    TOURNAMENT_REGISTRATION_APPROVED_QUEUE,
    TOURNAMENT_REGISTRATION_RANK_CHECK_QUEUE,
)
from shared.observability import observe_message_processing

from . import runtime, scheduler, tasks
from .settings import settings


def register_jobs(broker: Any, *, session_factory: Any, redis: Any, logger: Any) -> None:
    runtime.configure(session_factory=session_factory, redis=redis, broker=broker)
    rank_fetch_channel = Channel(prefetch_count=settings().rank_fetch_worker_prefetch)

    @broker.subscriber(RANK_FETCH_QUEUE, channel=rank_fetch_channel)
    async def process_rank_fetch(data: dict, msg: RabbitMessage) -> None:
        async with observe_message_processing(
            queue=RANK_FETCH_QUEUE, handler="process_rank_fetch", message=msg, logger=logger
        ):
            await tasks.process_fetch_rank(data)

    @broker.subscriber(RANK_FETCH_PRIORITY_QUEUE, channel=rank_fetch_channel)
    async def process_rank_fetch_priority(data: dict, msg: RabbitMessage) -> None:
        async with observe_message_processing(
            queue=RANK_FETCH_PRIORITY_QUEUE, handler="process_rank_fetch_priority", message=msg, logger=logger
        ):
            await tasks.process_fetch_rank(data)

    @broker.subscriber(TOURNAMENT_REGISTRATION_APPROVED_QUEUE, exchange=TOURNAMENT_EVENTS_EXCHANGE)
    async def process_registration_approved_rank_check(data: dict, msg: RabbitMessage) -> None:
        async with observe_message_processing(
            queue=TOURNAMENT_REGISTRATION_APPROVED_QUEUE,
            handler="process_registration_approved_rank_check",
            message=msg,
            logger=logger,
        ):
            await tasks.handle_registration_approved(data, broker=broker)

    # The registrant's own "check again" from their card: same rank check, own queue.
    @broker.subscriber(TOURNAMENT_REGISTRATION_RANK_CHECK_QUEUE, exchange=TOURNAMENT_EVENTS_EXCHANGE)
    async def process_registration_rank_check(data: dict, msg: RabbitMessage) -> None:
        async with observe_message_processing(
            queue=TOURNAMENT_REGISTRATION_RANK_CHECK_QUEUE,
            handler="process_registration_rank_check",
            message=msg,
            logger=logger,
        ):
            await tasks.handle_registration_approved(data, broker=broker)


async def start_jobs(*, session_factory: Any, redis: Any, logger: Any) -> None:
    runtime.configure(session_factory=session_factory, redis=redis)
    await tasks.rank_client.start()
    # Periodic OverFast rank collection trigger (Redis leader-locked across worker replicas, admin-settings-gated —
    # no-ops while collection is disabled).
    scheduler.start_scheduler()
    logger.info("OverFast rank collector started")


def stop_jobs() -> Awaitable[None]:
    """Stops the schedules now; the returned awaitable closes the OverFast client (after the consumers drained)."""
    scheduler.shutdown_scheduler()
    return tasks.rank_client.close()
