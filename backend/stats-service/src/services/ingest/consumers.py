"""The worker's ingest consumers: ``stats.ingest.<discipline>`` and its ``.replay`` queue, per selected discipline."""

from __future__ import annotations

from collections.abc import Iterable
from typing import Any

from faststream.rabbit import Channel, RabbitQueue
from faststream.rabbit.annotations import RabbitMessage
from sqlalchemy.exc import SQLAlchemyError

from shared import models
from shared.disciplines import DisciplineSpec
from shared.messaging.config import ingest_queue, ingest_replay_queue
from shared.observability import metrics, observe_message_processing
from shared.repository.stats import IngestJobRepository
from shared.schemas.events import ProcessIngestJobEvent
from src.core import db
from src.core.clients import s3_client
from src.services.ingest.jobs import IngestRejected, decode_error
from src.services.ingest.process import process_ingest_job, reparse_authorized_job
from src.services.match_logs.result_events import publish_match_log_result

__all__ = ("process_ingest_message", "process_replay_message", "register")

_jobs = IngestJobRepository()


async def _refuse_foreign_job(session: Any, job_id: int, discipline: str, queue: RabbitQueue) -> None:
    """Reject (to the DLQ, untouched) a job of another discipline; its row stays pending for its own queue's reaper."""
    job_discipline = await _jobs.get_discipline(session, job_id)
    await session.rollback()
    if job_discipline is not None and job_discipline != discipline:
        raise ValueError(f"Ingest job {job_id} is a {job_discipline!r} job delivered to {queue.name}")


async def process_ingest_message(discipline: str, data: dict, msg: RabbitMessage, *, broker: Any, logger: Any) -> None:
    """Process the job of one ``stats.ingest.<discipline>`` delivery; a job of another discipline is refused."""
    queue = ingest_queue(discipline)
    async with observe_message_processing(
        queue=queue,
        handler="process_ingest_job",
        message=msg,
        logger=logger,
    ):
        event = ProcessIngestJobEvent.model_validate(data)
        log = logger.bind(ingest_job_id=event.ingest_job_id, discipline=discipline)
        if event.reparse_expected_revision is not None:
            raise ValueError(
                f"Replay request for job {event.ingest_job_id} delivered to {queue.name}, not its replay queue"
            )
        async with db.async_session_maker() as session:
            await _refuse_foreign_job(session, event.ingest_job_id, discipline, queue)
            status = await process_ingest_job(session, event.ingest_job_id, s3_client, is_raise=False)
            if status == models.IngestJobStatus.PROCESSING:
                # Another delivery owns this claim. Acknowledge without
                # resolving its uploader's waiter or changing the job outcome.
                return
            job = await _jobs.get(session, event.ingest_job_id, populate_existing=True)
            if job.hint_tournament_id is not None or event.correlation_id is not None:
                # A canonical API job has neither: nobody waits for it, the client polls the job.
                error = decode_error(job.error_message)
                await publish_match_log_result(
                    broker,
                    job.hint_tournament_id,
                    job.filename,
                    status.value,
                    ingest_job_id=job.id,
                    correlation_id=event.correlation_id,
                    error_message=error.message if error else None,
                    channel_id=event.channel_id,
                    message_id=event.message_id,
                    logger=log,
                )
        metrics.count("stats.ingest.processed", 1, attributes={"status": status.value, "discipline": discipline})


async def process_replay_message(discipline: str, data: dict, msg: RabbitMessage, *, logger: Any) -> None:
    """The revision-fenced reparse of one DONE job from ``stats.ingest.<discipline>.replay``.

    Run only by a worker serving the job's discipline. Stale/busy is a result, acknowledged and reported per job;
    a transient storage failure (``ingest_unavailable``, a database error) is requeued, never acknowledged as a
    result, because this queue is the only record of the replay request. Anything else is poison and rejected to
    ``.replay.dlq``. A job of another discipline is rejected the same way; nothing is published to the uploader.
    """
    queue = ingest_replay_queue(discipline)
    async with observe_message_processing(
        queue=queue, handler="process_ingest_replay", message=msg, logger=logger
    ) as context:
        event = ProcessIngestJobEvent.model_validate(data)
        if event.reparse_expected_revision is None:
            raise ValueError(f"Job {event.ingest_job_id} on {queue.name} carries no expected revision")
        log = logger.bind(ingest_job_id=event.ingest_job_id, discipline=discipline)
        async with db.async_session_maker() as session:
            await _refuse_foreign_job(session, event.ingest_job_id, discipline, queue)
            outcome = "replayed"
            try:
                await reparse_authorized_job(
                    session,
                    job_id=event.ingest_job_id,
                    expected_revision=event.reparse_expected_revision,
                    s3=s3_client,
                )
            except IngestRejected as exc:
                outcome = "requeued" if exc.code == "ingest_unavailable" else "refused"
                log.warning("Reparse of log {} {}: {}", event.ingest_job_id, outcome, exc.code)
            except SQLAlchemyError:
                outcome = "requeued"
                log.exception("Reparse of log {} hit a database error", event.ingest_job_id)
        metrics.count("stats.ingest.replayed", 1, attributes={"outcome": outcome, "discipline": discipline})
        if outcome == "requeued":
            await msg.nack(requeue=True)
            context.set_status("requeued")


def _consumers(code: str, broker: Any, logger: Any) -> tuple[Any, Any]:
    # Closures, not default arguments: FastStream decodes every handler parameter from the message.
    async def ingest(data: dict, msg: RabbitMessage) -> None:
        await process_ingest_message(code, data, msg, broker=broker, logger=logger)

    async def replay(data: dict, msg: RabbitMessage) -> None:
        await process_replay_message(code, data, msg, logger=logger)

    ingest.__name__ = f"process_ingest_{code}"
    replay.__name__ = f"process_ingest_replay_{code}"
    return ingest, replay


def register(broker: Any, logger: Any, *, disciplines: Iterable[DisciplineSpec]) -> None:
    """One ingest and one replay consumer per discipline, each on an AMQP channel of its own.

    An ingest job is the one minutes-long handler in the worker, and a delivery that outlives RabbitMQ's
    consumer_timeout (30 minutes by default) gets its whole channel closed, taking every consumer sharing it down with
    it: so one slow log stalls neither the other game's ingest nor the short handlers. Tournament replays (a whole
    tournament's worth of reparses) run one at a time.
    """
    for spec in disciplines:
        ingest, replay = _consumers(spec.code, broker, logger)
        broker.subscriber(ingest_queue(spec.code), channel=Channel(prefetch_count=2))(ingest)
        broker.subscriber(ingest_replay_queue(spec.code), channel=Channel(prefetch_count=1))(replay)
