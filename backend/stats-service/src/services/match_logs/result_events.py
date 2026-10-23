"""Publish match-log processing results back to the uploading bot.

The result names the Discord message it answers (``channel_id``/``message_id``) and goes to one durable work queue,
so whichever discord-service replica consumes it reacts on that message: there is no in-process waiter to find.
"""

from typing import Any, Literal

from loguru import logger as default_logger

from shared.messaging.config import MATCH_LOG_RESULT_QUEUE
from shared.observability import publish_message
from shared.schemas.events import MatchLogProcessedEvent


async def publish_match_log_result(
    broker: Any,
    tournament_id: int | None,
    filename: str,
    status: Literal["done", "failed", "awaiting_link"],
    *,
    ingest_job_id: int | None = None,
    correlation_id: str | None = None,
    error_message: str | None = None,
    channel_id: int | None = None,
    message_id: int | None = None,
    logger: Any = default_logger,
) -> None:
    """Send a single match-log result to the bot.

    Failure to publish must never fail the worker message (the uploader just gets no reaction), so broker errors are
    logged and swallowed.
    """
    event = MatchLogProcessedEvent(
        tournament_id=tournament_id,
        filename=filename,
        status=status,
        ingest_job_id=ingest_job_id,
        correlation_id=correlation_id,
        error_message=error_message,
        channel_id=channel_id,
        message_id=message_id,
        source_service="stats-service",
    )
    try:
        await publish_message(
            broker,
            event.model_dump(),
            MATCH_LOG_RESULT_QUEUE,
            correlation_id=correlation_id,
            logger=logger,
        )
    except Exception:
        logger.bind(tournament_id=tournament_id, filename=filename).exception(
            "Failed to publish match log result event"
        )
