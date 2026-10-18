"""Publish match-log processing results back to the uploading bot.

The result is broadcast over a fanout exchange so every discord-service replica
receives it; the replica holding the pending upload future resolves it. This
replaces pg ``LISTEN/NOTIFY``, which pgBouncer transaction pooling breaks.
"""

from typing import Any, Literal

from loguru import logger as default_logger

from shared.messaging.config import MATCH_LOG_RESULT_EXCHANGE
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
    logger: Any = default_logger,
) -> None:
    """Broadcast a single match-log result so the waiting bot can stop blocking.

    Failure to publish must never fail the worker message (the bot simply falls
    back to its own timeout), so broker errors are logged and swallowed.
    """
    event = MatchLogProcessedEvent(
        tournament_id=tournament_id,
        filename=filename,
        status=status,
        ingest_job_id=ingest_job_id,
        correlation_id=correlation_id,
        error_message=error_message,
        source_service="stats-service",
    )
    try:
        await publish_message(
            broker,
            event.model_dump(),
            "",  # routing handled by the fanout exchange
            exchange=MATCH_LOG_RESULT_EXCHANGE,
            routing_key="",
            correlation_id=correlation_id,
            logger=logger,
        )
    except Exception:
        logger.bind(tournament_id=tournament_id, filename=filename).exception(
            "Failed to publish match log result event"
        )
