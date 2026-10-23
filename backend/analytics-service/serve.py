from faststream import FastStream
from faststream.rabbit.annotations import RabbitMessage

from shared.messaging.config import (
    ANALYTICS_JOB_DLQ,
    ANALYTICS_JOB_QUEUE,
    TOURNAMENT_STATE_CHANGED_DLQ,
)
from shared.messaging.outbox import drain_outbox
from shared.messaging.topology import declare_dead_letter_queue
from shared.observability import (
    make_rabbit_broker,
    observe_message_processing,
    setup_logging,
    setup_sentry,
    setup_tracing,
    start_worker_metrics_server,
)
from shared.schemas.events import AnalyticsJobRequested
from shared.services.realtime import configure_realtime
from src.core import config, db
from src.scheduler import register_jobs
from src.worker import tournament_events
from src.worker.job_runner import runner_service

logger = setup_logging(
    service_name="analytics-worker",
    log_level=config.settings.log_level,
    logs_root_path=config.settings.logs_root_path,
    json_output=config.settings.json_logging,
)

broker = make_rabbit_broker(config.settings.rabbitmq_url, logger=logger)
app = FastStream(broker)
scheduler = register_jobs()
# The automatic compute job (tournament_events) writes outbox rows from this process too.
scheduler.add_job(drain_outbox, "interval", seconds=1, id="event_outbox_drain", args=(db.async_session_maker, broker))

# Dead-letter queues this worker owns: every queue it consumes dead-letters to ``dlx``, and RabbitMQ creates nothing
# for the routing key, so without a declared, bound DLQ an expired or rejected message is dropped without a trace.
_OWNED_DLQS = (ANALYTICS_JOB_DLQ, TOURNAMENT_STATE_CHANGED_DLQ)

tournament_events.register(broker, logger)

# shared/services/realtime has no settings of its own; every emit() in this
# process publishes through what this call wires up.
configure_realtime(redis_url=str(config.settings.redis_url))


@app.on_startup
async def start_worker() -> None:
    await broker.connect()
    for dlq in _OWNED_DLQS:
        await declare_dead_letter_queue(broker, dlq)
    setup_sentry(
        dsn=config.settings.sentry_dsn,
        traces_sample_rate=config.settings.sentry_traces_sample_rate,
        profiles_sample_rate=config.settings.sentry_profiles_sample_rate,
        service_name="analytics-worker",
        enable_logs=config.settings.sentry_enable_logs,
        logs_level=config.settings.sentry_logs_level,
        enable_metrics=config.settings.sentry_enable_metrics,
        environment=config.settings.environment,
        release=config.settings.sentry_release,
        http_proxy=config.settings.sentry_http_proxy_url,
        https_proxy=config.settings.sentry_https_proxy_url,
    )
    setup_tracing(
        service_name="analytics-worker",
        otlp_endpoint=config.settings.otlp_endpoint,
        enabled=config.settings.tracing_enabled,
        sampler_name=config.settings.otel_traces_sampler,
        sampler_arg=config.settings.otel_traces_sampler_arg,
        environment=config.settings.environment,
        release=config.settings.sentry_release,
        engine=db.async_engine,
    )
    if config.settings.worker_metrics_port is not None:
        start_worker_metrics_server(config.settings.worker_metrics_port)
    scheduler.start()
    logger.info("Analytics worker started")


@app.on_shutdown
async def stop_worker() -> None:
    scheduler.shutdown(wait=False)
    logger.info("Analytics worker stopped")


@broker.subscriber(ANALYTICS_JOB_QUEUE)
async def consume_analytics_job(data: dict, msg: RabbitMessage) -> None:
    """Single dispatcher for the unified analytics-job pipeline.

    Looks up the persisted :class:`AnalyticsJob` row by id, dispatches by
    ``kind``, and publishes progress events to the
    ``workspace:{id}:analytics_jobs`` realtime topic.
    """
    async with observe_message_processing(
        queue=ANALYTICS_JOB_QUEUE,
        handler="consume_analytics_job",
        message=msg,
        logger=logger,
    ):
        event = AnalyticsJobRequested.model_validate(data)
        logger.bind(job_id=event.job_id).info("Consuming analytics job")
        async with db.async_session_maker() as session:
            await runner_service.run_job(session, event.job_id)
