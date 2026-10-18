import base64
from collections.abc import Awaitable

import sqlalchemy as sa
from faststream import FastStream
from faststream.rabbit import Channel
from faststream.rabbit.annotations import RabbitMessage

from shared.core.social import SocialProvider, normalize_social_handle
from shared.disciplines import DISCIPLINES
from shared.disciplines import jobs as discipline_jobs
from shared.messaging.config import (
    ACHIEVEMENT_EVALUATE_DEFERRED_DLQ,
    ACHIEVEMENT_EVALUATE_DEFERRED_QUEUE,
    ACHIEVEMENT_EVALUATE_DLQ,
    ACHIEVEMENT_EVALUATE_QUEUE,
    PROCESS_MATCH_LOG_DLQ,
    PROCESS_MATCH_LOG_QUEUE,
    PROCESS_TOURNAMENT_LOGS_DLQ,
    PROCESS_TOURNAMENT_LOGS_QUEUE,
    RANK_FETCH_DLQ,
    RANK_FETCH_PRIORITY_DLQ,
    TOURNAMENT_ENCOUNTER_COMPLETED_DLQ,
    TOURNAMENT_ENCOUNTER_COMPLETED_QUEUE,
    TOURNAMENT_EVENTS_EXCHANGE,
    TOURNAMENT_REGISTRATION_APPROVED_DLQ,
    TOURNAMENT_REGISTRATION_RANK_CHECK_DLQ,
    UPLOAD_MATCH_LOG_DLQ,
    UPLOAD_MATCH_LOG_QUEUE,
)
from shared.messaging.outbox import enqueue_outbox_event
from shared.messaging.topology import declare_dead_letter_queue
from shared.observability import (
    make_rabbit_broker,
    metrics,
    observe_message_processing,
    publish_message,
    setup_logging,
    setup_sentry,
    setup_tracing,
    start_worker_metrics_server,
)
from shared.quota import close as close_quota
from shared.quota import configure as configure_quota
from shared.schemas.events import (
    AchievementEvaluateEvent,
    EncounterCompletedEvent,
    ProcessIngestJobEvent,
    ProcessTournamentLogsEvent,
    UploadMatchLogEvent,
)
from shared.services.realtime import configure_realtime
from src import models
from src.core import config, db
from src.core.broker import set_worker_broker
from src.core.caching import configure_cache
from src.core.clients import realtime_redis, s3_client
from src.rpc import (
    achievements as rpc_achievements,
)
from src.rpc import (
    impact as rpc_impact,
)
from src.rpc import (
    ingest as rpc_ingest,
)
from src.rpc import (
    logs as rpc_logs,
)
from src.rpc import (
    misc as rpc_misc,
)
from src.rpc import (
    rank as rpc_rank,
)
from src.rpc import (
    subscription as rpc_subscription,
)
from src.services.achievement.engine.consumer import (
    handle_achievement_evaluate,
    handle_achievement_evaluate_deferred,
)
from src.services.ingest.jobs import decode_error
from src.services.ingest.process import process_ingest_job
from src.services.match_logs import flows as logs_flows
from src.services.match_logs import reaper as logs_reaper
from src.services.match_logs import retention as logs_retention
from src.services.match_logs import uploads as upload_service
from src.services.match_logs.log_records import log_records_service
from src.services.match_logs.objectiveless import resolve_encounter_maps
from src.services.match_logs.result_events import publish_match_log_result
from src.services.subscription_collection import scheduler as subscription_scheduler

logger = setup_logging(
    service_name="parser-svc",
    log_level=config.settings.log_level,
    logs_root_path=config.settings.logs_root_path,
    json_output=config.settings.json_logging,
)

broker = make_rabbit_broker(
    config.settings.rabbitmq_url, logger=logger, prefetch_count=config.settings.rpc_prefetch_count
)
app = FastStream(broker)

# Background jobs stay off the RPC channel QoS.
_JOBS_CHANNEL = Channel(prefetch_count=2)
# process_match_log is the one minutes-long handler here, and a delivery that
# outlives RabbitMQ's consumer_timeout (30 minutes by default) gets its whole
# channel closed — taking every consumer sharing it down with it. Its own channel
# keeps that blast radius to itself: upload_match_log, process_tournament_logs
# and achievement_evaluate stay live.
_MATCH_LOG_CHANNEL = Channel(prefetch_count=2)
# Deferred achievement recompute for unverified workspaces: a full-history run
# an operator asked for, on a workspace nobody has vouched for. One at a time,
# so it can never crowd out the parse-driven evaluations on _JOBS_CHANNEL.
_ACHIEVEMENT_DEFERRED_CHANNEL = Channel(prefetch_count=1)

# Dead-letter queues this worker owns. Every queue it consumes carries
# x-dead-letter-exchange=dlx plus an x-message-ttl, but nothing declared these or
# bound them to the DLX — so an expired job (a batch upload the worker could not
# chew inside the 5-minute process_match_log TTL) was routed to `dlx` with a
# routing key nothing was bound to and dropped without a trace. The log row kept
# saying "Queued" and there was no DLQ to prove why.
_OWNED_DLQS = (
    UPLOAD_MATCH_LOG_DLQ,
    PROCESS_MATCH_LOG_DLQ,
    PROCESS_TOURNAMENT_LOGS_DLQ,
    ACHIEVEMENT_EVALUATE_DLQ,
    ACHIEVEMENT_EVALUATE_DEFERRED_DLQ,
    RANK_FETCH_DLQ,
    RANK_FETCH_PRIORITY_DLQ,
    TOURNAMENT_ENCOUNTER_COMPLETED_DLQ,
    TOURNAMENT_REGISTRATION_APPROVED_DLQ,
    TOURNAMENT_REGISTRATION_RANK_CHECK_DLQ,
)

# Expose the worker broker to publishers that don't thread one through (the
# APScheduler rank tick, the admin "collect now" RPC, the Challonge-import
# standings-recalculation enqueue, ...). Replaces the old task_router.broker
# fallback now that the fastapi RabbitRouter is gone.
set_worker_broker(broker)

# The cashews singleton is process-global with no default backend; configure it
# before any subscriber runs so cache reads/invalidation are routable.
configure_cache()

# Same reason and same place as configure_cache: shared/services/realtime has no
# settings of its own, and every emit() in this process publishes through it.
configure_realtime(redis_url=str(config.settings.redis_url))
# Quota policy lives in the ``quota`` schema and consumption in Redis; the gate
# needs both before the first metered RPC. Same Redis as the realtime rail.
configure_quota(
    session_factory=db.async_session_maker,
    redis_url=str(config.settings.redis_url),
    enabled=config.settings.quota_enabled,
    edge_workspace_metering=config.settings.quota_edge_workspace_metering,
)

# Typed-RPC subscribers for parser-unique domains served behind the gateway.
rpc_logs.register(broker, logger)
rpc_rank.register(broker, logger)
rpc_achievements.register(broker, logger)
rpc_misc.register(broker, logger)
rpc_impact.register(broker, logger)
rpc_ingest.register(broker, logger)
rpc_subscription.register(broker, logger)

# Disciplines whose jobs this worker runs: every installed one until Task 6 adds STATS_DISCIPLINES selection.
_JOB_DISCIPLINES = tuple(DISCIPLINES.values())
# stop_jobs() awaitables handed back at shutdown start, awaited once the consumers have drained.
_pending_closes: list[Awaitable[None]] = []
discipline_jobs.register_jobs(
    _JOB_DISCIPLINES, broker, session_factory=db.async_session_maker, redis=realtime_redis, logger=logger
)


@app.on_startup
async def start_worker() -> None:
    await broker.connect()
    for dlq in _OWNED_DLQS:
        await declare_dead_letter_queue(broker, dlq)
    setup_sentry(
        dsn=config.settings.sentry_dsn,
        traces_sample_rate=config.settings.sentry_traces_sample_rate,
        profiles_sample_rate=config.settings.sentry_profiles_sample_rate,
        service_name="parser-svc",
        enable_logs=config.settings.sentry_enable_logs,
        logs_level=config.settings.sentry_logs_level,
        enable_metrics=config.settings.sentry_enable_metrics,
        environment=config.settings.environment,
        release=config.settings.sentry_release,
        http_proxy=config.settings.sentry_http_proxy_url,
        https_proxy=config.settings.sentry_https_proxy_url,
    )
    setup_tracing(
        service_name="parser-svc",
        otlp_endpoint=config.settings.otlp_endpoint,
        enabled=config.settings.tracing_enabled,
        sampler_name=config.settings.otel_traces_sampler,
        sampler_arg=config.settings.otel_traces_sampler_arg,
        environment=config.settings.environment,
        release=config.settings.sentry_release,
        engine=db.async_engine,
    )
    start_worker_metrics_server(config.settings.worker_metrics_port)
    await s3_client.start()
    # The selected disciplines' jobs: OverFast client and rank schedule for Overwatch, nothing for LoL.
    await discipline_jobs.start_jobs(
        _JOB_DISCIPLINES, session_factory=db.async_session_maker, redis=realtime_redis, logger=logger
    )
    # Requeue match-log records the queue dropped (expired ProcessIngestJobEvent,
    # worker killed mid-parse) through the outbox. Redis leader-locked across worker replicas.
    logs_reaper.start_scheduler(redis=realtime_redis)
    # Drop failed match logs (S3 object + record) past their retention window.
    logs_retention.start_scheduler(redis=realtime_redis, s3=s3_client)
    subscription_scheduler.start_scheduler()
    logger.info("Parser worker started")


@app.on_shutdown
async def stop_worker() -> None:
    _pending_closes.extend(discipline_jobs.stop_jobs(_JOB_DISCIPLINES))
    logs_reaper.shutdown_scheduler()
    logs_retention.shutdown_scheduler()
    subscription_scheduler.shutdown_scheduler()


@app.after_shutdown
async def close_worker_resources() -> None:
    # Consumers must finish before their HTTP, S3 and Redis clients are closed.
    await s3_client.close()
    for closing in _pending_closes:
        await closing
    await realtime_redis.aclose()
    # The quota gate holds its own process-global Redis client (see
    # shared.quota.configure); every worker restart leaks a connection without this.
    await close_quota()


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
                job_id = job.id
            await publish_message(
                broker,
                ProcessIngestJobEvent(
                    ingest_job_id=job_id,
                    correlation_id=event.correlation_id,
                ).model_dump(),
                PROCESS_MATCH_LOG_QUEUE,
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


@broker.subscriber(PROCESS_MATCH_LOG_QUEUE, channel=_MATCH_LOG_CHANNEL)
async def process_match_log_async(data: dict, msg: RabbitMessage) -> None:
    from shared.repository.stats import IngestJobRepository

    async with observe_message_processing(
        queue=PROCESS_MATCH_LOG_QUEUE,
        handler="process_match_log_async",
        message=msg,
        logger=logger,
    ):
        event = ProcessIngestJobEvent.model_validate(data)
        log = logger.bind(ingest_job_id=event.ingest_job_id)
        async with db.async_session_maker() as session:
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
        metrics.count("parser.match_log.processed", 1, attributes={"status": status.value})


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
                job_ids = await log_records_service.requeue_tournament(session, event.tournament_id)
            for job_id in job_ids:
                await publish_message(
                    broker,
                    ProcessIngestJobEvent(ingest_job_id=job_id).model_dump(),
                    PROCESS_MATCH_LOG_QUEUE,
                    logger=logger.bind(ingest_job_id=job_id),
                )
            logger.info("Queued {} logs for tournament {}", len(job_ids), event.tournament_id)
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
            if await resolve_encounter_maps(session, event.encounter_id):
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
