"""The tournament consumer of ``match.ingested`` (stats-service -> match layer).

One delivery is one transaction: :func:`apply_match_evidence` stages the receipt, the roster and the result, this
handler commits once, and FastStream acknowledges only after the handler returns. A malformed payload or any
logic error propagates (``observe_message_processing`` re-raises, FastStream rejects without requeue and the
message lands in ``match.ingested.tournament.dlq``). A transient database failure rolls the whole delivery back
and is requeued, so no partial roster/result/receipt can exist and the redelivery applies once.

``ponytail:`` a requeue has no backoff; add a delayed retry queue if a database outage shows hot redelivery.
"""

from __future__ import annotations

from typing import Any

from faststream.rabbit import Channel, RabbitRouter
from faststream.rabbit.annotations import RabbitMessage
from loguru import logger
from sqlalchemy.exc import InterfaceError, OperationalError

from shared.messaging.config import MATCH_INGESTED_EXCHANGE, MATCH_INGESTED_TOURNAMENT_QUEUE
from shared.observability import observe_message_processing
from shared.schemas.events import MatchIngestedEvent
from src.core import db
from src.services.encounter.log_evidence import apply_match_evidence

__all__ = ("process_match_ingested", "task_router")

task_router = RabbitRouter()

# Isolated channel: a log-upload burst must not occupy the RPC default-channel QoS slots.
_INGEST_CHANNEL = Channel(prefetch_count=4)

#: Connection loss, deadlock and serialization failure are all ``OperationalError``/``InterfaceError``.
_TRANSIENT = (OperationalError, InterfaceError)


async def process_match_ingested(data: dict[str, Any]) -> str | None:
    """Validate, apply and commit one delivery; ``None`` when the database was transiently unavailable."""
    event = MatchIngestedEvent.model_validate(data)
    try:
        async with db.async_session_maker() as session:
            outcome = await apply_match_evidence(session, event)
            await session.commit()
    except _TRANSIENT:
        logger.warning(f"match.ingested {event.event_id}: database unavailable, requeueing")
        return None
    return outcome


@task_router.subscriber(MATCH_INGESTED_TOURNAMENT_QUEUE, exchange=MATCH_INGESTED_EXCHANGE, channel=_INGEST_CHANNEL)
async def consume_match_ingested(data: dict[str, Any], msg: RabbitMessage) -> None:
    async with observe_message_processing(
        queue=MATCH_INGESTED_TOURNAMENT_QUEUE,
        handler="consume_match_ingested",
        message=msg,
        logger=logger,
    ) as context:
        outcome = await process_match_ingested(data)
        if outcome is None:
            await msg.nack(requeue=True)
            context.set_status("requeued")
            return
        context.logger.bind(outcome=outcome).info("match.ingested decided")
