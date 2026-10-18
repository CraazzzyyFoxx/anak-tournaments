"""The stats worker process: every consumer and schedule, and no RPC handler.

Consumes ``stats.ingest.<discipline>`` for the disciplines ``STATS_DISCIPLINES`` selects (every installed one when
unset), the upload/tournament fanout, achievement evaluation, ``tournament.encounter.completed`` and each selected
discipline module's own jobs (the OverFast rank collector), and runs the reaper, failed-log retention and subscription
schedules. Run: ``faststream run serve_worker:app``.
"""

import base64
from collections.abc import Awaitable

import sqlalchemy as sa
from faststream.rabbit import Channel
from faststream.rabbit.annotations import RabbitMessage

from shared.core.social import SocialProvider, normalize_social_handle
from shared.disciplines import jobs as discipline_jobs
from shared.messaging.config import (
    ACHIEVEMENT_EVALUATE_DEFERRED_DLQ,
    ACHIEVEMENT_EVALUATE_DEFERRED_QUEUE,
    ACHIEVEMENT_EVALUATE_DLQ,
    ACHIEVEMENT_EVALUATE_QUEUE,
    PROCESS_TOURNAMENT_LOGS_DLQ,
    PROCESS_TOURNAMENT_LOGS_QUEUE,
    TOURNAMENT_ENCOUNTER_COMPLETED_DLQ,
    TOURNAMENT_ENCOUNTER_COMPLETED_QUEUE,
    TOURNAMENT_EVENTS_EXCHANGE,
    UPLOAD_MATCH_LOG_DLQ,
    UPLOAD_MATCH_LOG_QUEUE,
    ingest_dlq,
    ingest_queue,
    ingest_replay_dlq,
    ingest_replay_queue,
)
from shared.messaging.outbox import enqueue_outbox_event
from shared.messaging.topology import declare_dead_letter_queue, declare_replay_queues, publish_required
from shared.observability import metrics, observe_message_processing, publish_message
from shared.schemas.events import (
    AchievementEvaluateEvent,
    EncounterCompletedEvent,
    ProcessIngestJobEvent,
    ProcessTournamentLogsEvent,
    UploadMatchLogEvent,
)
from src import models
from src.core import config, db
from src.core.clients import realtime_redis, s3_client
from src.core.lifecycle import Readiness, close_clients, create_process, start_clients, start_observability
from src.services.achievement.engine.consumer import (
    handle_achievement_evaluate,
    handle_achievement_evaluate_deferred,
)
from src.services.ingest.jobs import IngestRejected, decode_error
from src.services.ingest.process import process_ingest_job, reparse_authorized_job
from src.services.match_logs import flows as logs_flows
from src.services.match_logs import reaper as logs_reaper
from src.services.match_logs import retention as logs_retention
from src.services.match_logs import uploads as upload_service
from src.services.match_logs.log_records import log_records_service
from src.services.match_logs.objectiveless import load_producers, resolve_encounter_maps
from src.services.match_logs.result_events import publish_match_log_result
from src.services.subscription_collection import scheduler as subscription_scheduler

SERVICE_NAME = "stats-worker"

logger, broker, app = create_process(SERVICE_NAME, prefetch_count=config.settings.rpc_prefetch_count)
readiness = Readiness(broker)

# Fails the import, hence the start, on an invalid STATS_DISCIPLINES (see config.select_disciplines).
SELECTED = config.settings.selected_disciplines

# Background jobs stay off the RPC channel QoS.
_JOBS_CHANNEL = Channel(prefetch_count=2)
# An ingest job is the one minutes-long handler here, and a delivery that outlives RabbitMQ's consumer_timeout (30
# minutes by default) gets its whole channel closed — taking every consumer sharing it down with it. Each discipline's
# ingest queue has a channel of its own, so one slow log stalls neither the other game's ingest nor upload_match_log,
# process_tournament_logs and achievement_evaluate.
_INGEST_CHANNELS = {spec.code: Channel(prefetch_count=2) for spec in SELECTED}
# Tournament replays (a whole tournament's worth of reparses) run one at a time on a channel of their own.
_REPLAY_CHANNELS = {spec.code: Channel(prefetch_count=1) for spec in SELECTED}
# Deferred achievement recompute for unverified workspaces: a full-history run an operator asked for, on a workspace
# nobody has vouched for. One at a time, so it can never crowd out the parse-driven evaluations on _JOBS_CHANNEL.
_ACHIEVEMENT_DEFERRED_CHANNEL = Channel(prefetch_count=1)

# Dead-letter queues this worker owns. Every queue it consumes carries x-dead-letter-exchange=dlx plus an x-message-ttl,
# but RabbitMQ creates nothing for the dead-letter routing key: without a declared, bound DLQ an expired job (a log the
# worker could not chew inside the 5-minute ingest TTL) is dropped without a trace while its row says "Queued". The rank
# and registration-check queues are consumed by the OverFast module, which declares their DLQs itself.
_OWNED_DLQS = (
    UPLOAD_MATCH_LOG_DLQ,
    *(ingest_dlq(spec.code) for spec in SELECTED),
    *(ingest_replay_dlq(spec.code) for spec in SELECTED),
    PROCESS_TOURNAMENT_LOGS_DLQ,
    ACHIEVEMENT_EVALUATE_DLQ,
    ACHIEVEMENT_EVALUATE_DEFERRED_DLQ,
    TOURNAMENT_ENCOUNTER_COMPLETED_DLQ,
)

# stop_jobs() awaitables handed back at shutdown start, awaited once the consumers have drained.
_pending_closes: list[Awaitable[None]] = []
discipline_jobs.register_jobs(
    SELECTED, broker, session_factory=db.async_session_maker, redis=realtime_redis, logger=logger
)


@app.on_startup
async def start_worker() -> None:
    await broker.connect()
    for dlq in _OWNED_DLQS:
        await declare_dead_letter_queue(broker, dlq)
    start_observability(SERVICE_NAME, readiness)
    await start_clients()
    # The selected disciplines' jobs: their dead-letter queues, the OverFast client and rank schedule for Overwatch,
    # nothing for LoL.
    await discipline_jobs.start_jobs(
        SELECTED, session_factory=db.async_session_maker, redis=realtime_redis, logger=logger
    )
    # Requeue ingest jobs the queue dropped (expired ProcessIngestJobEvent, worker killed mid-parse) through the outbox,
    # for the selected disciplines only. Redis leader-locked across worker replicas.
    logs_reaper.start_scheduler(redis=realtime_redis, disciplines=[spec.code for spec in SELECTED])
    # Drop failed match logs (S3 object + record) past their retention window.
    logs_retention.start_scheduler(redis=realtime_redis, s3=s3_client)
    subscription_scheduler.start_scheduler()
    readiness.bind()


@app.after_startup
async def serve_worker() -> None:
    readiness.serving(True)
    logger.info("Stats worker started: ingest for {}", ", ".join(spec.code for spec in SELECTED))


@app.on_shutdown
async def stop_worker() -> None:
    readiness.serving(False)
    _pending_closes.extend(discipline_jobs.stop_jobs(SELECTED))
    logs_reaper.shutdown_scheduler()
    logs_retention.shutdown_scheduler()
    subscription_scheduler.shutdown_scheduler()


@app.after_shutdown
async def close_worker_resources() -> None:
    # Consumers must finish before their HTTP, S3 and Redis clients are closed.
    await close_clients(_pending_closes)


@broker.subscriber(UPLOAD_MATCH_LOG_QUEUE, channel=_JOBS_CHANNEL)
async def process_upload_match_log(data: dict, msg: RabbitMessage) -> None:
    """Hash/store actual bytes, create or reuse a native job, preserve the upload correlation."""
    async with observe_message_processing(
        queue=UPLOAD_MATCH_LOG_QUEUE,
        handler="process_upload_match_log",
        message=msg,
        logger=logger,
    ):
        event = UploadMatchLogEvent.model_validate(data)
        log = logger.bind(tournament_id=event.tournament_id, filename=event.filename)
        job_id = None
        try:
            max_bytes = config.settings.max_match_log_bytes
            if len(event.content_b64) > (max_bytes // 3 + 1) * 4:
                raise ValueError("Match log exceeds the upload size limit")
            content = base64.b64decode(event.content_b64, validate=True)
            async with db.async_session_maker() as session:
                uploader_user_id = None
                if event.uploader_discord_name:
                    uploader_user_id = await session.scalar(
                        sa.select(models.SocialAccount.user_id)
                        .where(
                            models.SocialAccount.provider == SocialProvider.DISCORD,
                            models.SocialAccount.username_normalized
                            == normalize_social_handle(SocialProvider.DISCORD, event.uploader_discord_name),
                        )
                        .limit(1)
                    )
                job = await upload_service.store_uploaded_log_bytes(
                    session,
                    s3=s3_client,
                    tournament_id=event.tournament_id,
                    filename=event.filename,
                    content=content,
                    source="discord" if event.uploader_discord_name else "manual",
                    uploader_id=uploader_user_id,
                )
                job_id, discipline = job.id, job.discipline
            await publish_message(
                broker,
                ProcessIngestJobEvent(
                    ingest_job_id=job_id,
                    correlation_id=event.correlation_id,
                ).model_dump(),
                ingest_queue(discipline),
                logger=log,
                correlation_id=event.correlation_id,
            )
        except Exception as exc:
            if job_id is not None:
                # Keep the durable pending job recoverable. Redelivery/reaper
                # retries dispatch; a queue outage is not a persisted parse failure.
                raise
            await publish_match_log_result(
                broker,
                event.tournament_id,
                event.filename,
                "failed",
                ingest_job_id=job_id,
                correlation_id=event.correlation_id,
                error_message=str(exc),
                logger=log,
            )
            log.exception("Failed to upload or queue match log")


async def process_ingest_message(discipline: str, data: dict, msg: RabbitMessage) -> None:
    """Process the job of one ``stats.ingest.<discipline>`` delivery; a job of another discipline is refused."""
    from shared.repository.stats import IngestJobRepository

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
            job_discipline = await session.scalar(
                sa.select(models.IngestJob.discipline).where(models.IngestJob.id == event.ingest_job_id)
            )
            await session.rollback()
            if job_discipline is not None and job_discipline != discipline:
                # Rejected to the DLQ untouched; the job row stays pending for the reaper of the queue it belongs to.
                raise ValueError(
                    f"Ingest job {event.ingest_job_id} is a {job_discipline!r} job delivered to {queue.name}"
                )
            status = await process_ingest_job(session, event.ingest_job_id, s3_client, is_raise=False)
            if status == models.IngestJobStatus.PROCESSING:
                # Another delivery owns this claim. Acknowledge without
                # resolving its uploader's waiter or changing the job outcome.
                return
            job = await IngestJobRepository().get(session, event.ingest_job_id, populate_existing=True)
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
                    logger=log,
                )
        metrics.count("stats.ingest.processed", 1, attributes={"status": status.value, "discipline": discipline})


async def process_replay_message(discipline: str, data: dict, msg: RabbitMessage) -> None:
    """The revision-fenced reparse of one DONE job from ``stats.ingest.<discipline>.replay``.

    Run only by a worker serving the job's discipline; stale/busy is reported per job and acknowledged (a refusal is a
    result, not a failure), nothing is published to the uploader. A job of another discipline is rejected to the DLQ.
    """
    queue = ingest_replay_queue(discipline)
    async with observe_message_processing(queue=queue, handler="process_ingest_replay", message=msg, logger=logger):
        event = ProcessIngestJobEvent.model_validate(data)
        if event.reparse_expected_revision is None:
            raise ValueError(f"Job {event.ingest_job_id} on {queue.name} carries no expected revision")
        log = logger.bind(ingest_job_id=event.ingest_job_id, discipline=discipline)
        async with db.async_session_maker() as session:
            job_discipline = await session.scalar(
                sa.select(models.IngestJob.discipline).where(models.IngestJob.id == event.ingest_job_id)
            )
            await session.rollback()
            if job_discipline is not None and job_discipline != discipline:
                raise ValueError(
                    f"Ingest job {event.ingest_job_id} is a {job_discipline!r} job delivered to {queue.name}"
                )
            outcome = "replayed"
            try:
                await reparse_authorized_job(
                    session,
                    job_id=event.ingest_job_id,
                    expected_revision=event.reparse_expected_revision,
                    s3=s3_client,
                )
            except IngestRejected as exc:
                outcome = "refused"
                log.warning("Reparse of log {} refused: {}", event.ingest_job_id, exc.code)
            except Exception:
                outcome = "refused"
                log.exception("Reparse of log {} failed", event.ingest_job_id)
        metrics.count("stats.ingest.replayed", 1, attributes={"outcome": outcome, "discipline": discipline})


def _replay_consumer(discipline: str):
    async def consume(data: dict, msg: RabbitMessage) -> None:
        await process_replay_message(discipline, data, msg)

    consume.__name__ = f"process_ingest_replay_{discipline}"
    return consume


def _ingest_consumer(discipline: str):
    async def consume(data: dict, msg: RabbitMessage) -> None:
        await process_ingest_message(discipline, data, msg)

    consume.__name__ = f"process_ingest_{discipline}"
    return consume


for _spec in SELECTED:
    broker.subscriber(ingest_queue(_spec.code), channel=_INGEST_CHANNELS[_spec.code])(_ingest_consumer(_spec.code))
    broker.subscriber(ingest_replay_queue(_spec.code), channel=_REPLAY_CHANNELS[_spec.code])(
        _replay_consumer(_spec.code)
    )


@broker.subscriber(PROCESS_TOURNAMENT_LOGS_QUEUE, channel=_JOBS_CHANNEL)
async def process_tournament_log(data: dict, msg: RabbitMessage) -> None:
    async with observe_message_processing(
        queue=PROCESS_TOURNAMENT_LOGS_QUEUE,
        handler="process_tournament_log",
        message=msg,
        logger=logger,
    ):
        event = ProcessTournamentLogsEvent.model_validate(data)
        logger.bind(tournament_id=event.tournament_id).info("Processing tournament logs from queue")
        try:
            async with db.async_session_maker() as session:
                requeued = await log_records_service.requeue_tournament(session, event.tournament_id)
            for job_id in requeued.queue:
                await publish_message(
                    broker,
                    ProcessIngestJobEvent(ingest_job_id=job_id).model_dump(),
                    ingest_queue(requeued.discipline),
                    logger=logger.bind(ingest_job_id=job_id),
                )
            # Done jobs are never re-pended: each is replayed through the discipline's TTL-less replay queue with the revision
            # seen at selection, so a log superseded or re-replaced in the meantime reports stale instead of winning.
            # This consumer never decodes: only a worker serving the job's discipline can.
            if requeued.replay:
                # The destination may not exist yet (no worker of that discipline has started on a fresh broker), and an
                # unroutable publish must fail this request rather than drop the reparses.
                await declare_replay_queues(broker, requeued.discipline)
            for job_id, revision in requeued.replay.items():
                await publish_required(
                    broker,
                    ingest_replay_queue(requeued.discipline),
                    ProcessIngestJobEvent(ingest_job_id=job_id, reparse_expected_revision=revision).model_dump_json(),
                )
            logger.info(
                "Tournament {} logs: {} queued, {} replays requested",
                event.tournament_id,
                len(requeued.queue),
                len(requeued.replay),
            )
        except Exception:
            logger.exception(f"Failed to process tournament logs tournament_id={event.tournament_id}")
            raise


@broker.subscriber(ACHIEVEMENT_EVALUATE_QUEUE, channel=_JOBS_CHANNEL)
async def process_achievement_evaluate(data: dict, msg: RabbitMessage) -> None:
    async with observe_message_processing(
        queue=ACHIEVEMENT_EVALUATE_QUEUE,
        handler="process_achievement_evaluate",
        message=msg,
        logger=logger,
    ):
        await handle_achievement_evaluate(data)


@broker.subscriber(ACHIEVEMENT_EVALUATE_DEFERRED_QUEUE, channel=_ACHIEVEMENT_DEFERRED_CHANNEL)
async def process_achievement_evaluate_deferred(data: dict, msg: RabbitMessage) -> None:
    async with observe_message_processing(
        queue=ACHIEVEMENT_EVALUATE_DEFERRED_QUEUE,
        handler="process_achievement_evaluate_deferred",
        message=msg,
        logger=logger,
    ):
        await handle_achievement_evaluate_deferred(data)


@broker.subscriber(TOURNAMENT_ENCOUNTER_COMPLETED_QUEUE, exchange=TOURNAMENT_EVENTS_EXCHANGE)
async def process_tournament_encounter_completed(data: dict, msg: RabbitMessage) -> None:
    async with observe_message_processing(
        queue=TOURNAMENT_ENCOUNTER_COMPLETED_QUEUE,
        handler="process_tournament_encounter_completed",
        message=msg,
        logger=logger,
    ):
        event = EncounterCompletedEvent.model_validate(data)
        async with db.async_session_maker() as session:
            workspace_id = await session.scalar(
                sa.select(models.Tournament.workspace_id).where(models.Tournament.id == event.tournament_id)
            )
            if workspace_id is None:
                raise RuntimeError(f"Tournament {event.tournament_id} not found")
            # Before the achievement run below: it reads per-map winners, and a
            # completed series is what decides a Push/Clash map by exclusion.
            producers = await load_producers(session, s3_client, event.encounter_id)
            if await resolve_encounter_maps(session, event.encounter_id, producers=producers):
                await logs_flows.enqueue_match_scores_changed(session, event.tournament_id, event.encounter_id)
            await enqueue_outbox_event(
                session,
                AchievementEvaluateEvent(
                    workspace_id=workspace_id,
                    tournament_id=event.tournament_id,
                    changed_tables=["tournament.encounter", "stats.fact"],
                ),
                exchange="",
                routing_key=ACHIEVEMENT_EVALUATE_QUEUE.name,
            )
            await session.commit()
