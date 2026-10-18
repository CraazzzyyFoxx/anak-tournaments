"""The tournament consumer of ``match.ingested`` (stats-service -> match layer).

One delivery is one transaction: :func:`apply_match_evidence` stages the receipt, the roster and the result, this
handler commits once, and FastStream acknowledges only after the handler returns. A malformed payload (including an
event naming another workspace or discipline) or any logic error propagates (``observe_message_processing``
re-raises, FastStream rejects without requeue and the message lands in ``match.ingested.tournament.dlq``). A
transient database failure rolls the whole delivery back and is requeued, so no partial roster/result/receipt can
exist and the redelivery applies once; a permanent database defect is still rejected, not retried forever.

An accepted result that completed a Challonge-linked encounter is pushed after the commit, outside the locks, by
the same helper the captain and lobby flows use. The push is external and best-effort: its failure is logged and
never undoes or re-delivers the committed decision.

``ponytail:`` a requeue has no backoff; add a delayed retry queue if a database outage shows hot redelivery.
"""

from __future__ import annotations

from typing import Any

import sqlalchemy as sa
from faststream.rabbit import Channel, RabbitRouter
from faststream.rabbit.annotations import RabbitMessage
from loguru import logger
from sqlalchemy.exc import DBAPIError

from shared.core.enums import EncounterResultStatus
from shared.messaging.config import MATCH_INGESTED_EXCHANGE, MATCH_INGESTED_TOURNAMENT_QUEUE
from shared.models.encounter.encounter import Encounter
from shared.observability import observe_message_processing
from shared.schemas.events import MatchIngestedEvent
from src.core import db
from src.services.encounter.log_evidence import ACCEPTED, apply_match_evidence
from src.services.encounter.settle import push_confirmed_to_challonge

__all__ = ("is_transient", "process_match_ingested", "task_router")

task_router = RabbitRouter()

# Isolated channel: a log-upload burst must not occupy the RPC default-channel QoS slots.
_INGEST_CHANNEL = Channel(prefetch_count=4)

#: SQLSTATE classes/codes worth another delivery: serialization failure, deadlock, lock not available, admin
#: shutdown/crash and the whole connection-exception class ``08``. Everything else (constraint, syntax, undefined
#: column, ...) is a defect a redelivery cannot cure.
_TRANSIENT_SQLSTATES = frozenset({"40001", "40P01", "55P03", "57P01", "57P02", "57P03"})


def _sqlstate(exc: BaseException | None) -> str | None:
    """The SQLSTATE of a driver error, looking through the adapter wrappers (``orig`` and ``__cause__``)."""
    for _ in range(4):
        if exc is None:
            return None
        state = getattr(exc, "sqlstate", None) or getattr(exc, "pgcode", None)
        if state:
            return str(state)
        exc = getattr(exc, "orig", None) or exc.__cause__
    return None


def is_transient(exc: DBAPIError) -> bool:
    """Whether a database failure is worth a redelivery (retryable SQLSTATE or an invalidated connection)."""
    if exc.connection_invalidated:
        return True
    state = _sqlstate(exc.orig)
    return state is not None and (state in _TRANSIENT_SQLSTATES or state.startswith("08"))


async def process_match_ingested(data: dict[str, Any]) -> str | None:
    """Validate, apply and commit one delivery; ``None`` when the database was transiently unavailable."""
    event = MatchIngestedEvent.model_validate(data)
    try:
        async with db.async_session_maker() as session:
            outcome = await apply_match_evidence(session, event)
            await session.commit()
            if outcome == ACCEPTED:
                await _push_to_challonge(session, event.encounter_id)
    except DBAPIError as exc:
        if not is_transient(exc):
            raise
        logger.warning(f"match.ingested {event.event_id}: database unavailable, requeueing")
        return None
    return outcome


async def _push_to_challonge(session: Any, encounter_id: int) -> None:
    """After the commit: the confirmed-result push every other result flow runs, never part of the decision."""
    confirmed = await session.scalar(sa.select(Encounter.result_status).where(Encounter.id == encounter_id))
    if confirmed != EncounterResultStatus.CONFIRMED:
        return
    try:
        await push_confirmed_to_challonge(session, encounter_id)
    except Exception:
        logger.exception(f"match.ingested: Challonge push for encounter {encounter_id} failed after commit")


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
