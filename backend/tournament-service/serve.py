from apscheduler.schedulers.asyncio import AsyncIOScheduler
from faststream import FastStream
from faststream.rabbit import RabbitBroker
from faststream.rabbit.annotations import RabbitMessage
from shared.messaging.config import (
    SWISS_NEXT_ROUND_QUEUE,
    TOURNAMENT_RECALC_EXCHANGE,
    TOURNAMENT_RECALC_QUEUE,
)
from shared.messaging.outbox import publish_pending_outbox_events
from shared.observability import (
    observe_message_processing,
    setup_logging,
    setup_tracing,
    start_worker_metrics_server,
)

from src.core import config, db
from src.services.admin.swiss_rounds import process_swiss_next_round_event
from src.services.registration import admin as registration_service
from src.services.standings import recalculation as standings_recalculation

logger = setup_logging(
    service_name="tournament-worker",
    log_level=config.settings.log_level,
    logs_root_path=config.settings.logs_root_path,
    json_output=config.settings.json_logging,
)

broker = RabbitBroker(config.settings.rabbitmq_url, logger=logger)
app = FastStream(broker)
scheduler = AsyncIOScheduler()


async def drain_outbox() -> None:
    async with db.async_session_maker() as session:
        published = await publish_pending_outbox_events(session, broker, limit=100, commit=True)
        if published:
            logger.info("Published %d outbox events", published)


async def sync_registration_google_sheet_feeds() -> None:
    results = await registration_service.sync_due_google_sheet_feeds(db.async_session_maker)
    if results:
        logger.info("Registration Google Sheets sync completed", results=results)


@app.on_startup
async def start_scheduler() -> None:
    setup_tracing(
        service_name="tournament-worker",
        otlp_endpoint=config.settings.otlp_endpoint,
        enabled=config.settings.tracing_enabled,
        sampler_name=config.settings.otel_traces_sampler,
        sampler_arg=config.settings.otel_traces_sampler_arg,
    )
    start_worker_metrics_server(config.settings.worker_metrics_port)
    scheduler.add_job(drain_outbox, "interval", seconds=10, id="event_outbox_drain")
    scheduler.add_job(
        sync_registration_google_sheet_feeds,
        "interval",
        minutes=5,
        id="registration_google_sheet_sync",
    )
    scheduler.start()
    logger.info("Tournament worker scheduler started")


@app.on_shutdown
async def stop_scheduler() -> None:
    scheduler.shutdown(wait=False)


@broker.subscriber(TOURNAMENT_RECALC_QUEUE, exchange=TOURNAMENT_RECALC_EXCHANGE)
async def process_tournament_recalculation(data: dict, msg: RabbitMessage) -> None:
    async with observe_message_processing(
        queue=TOURNAMENT_RECALC_QUEUE,
        handler="process_tournament_recalculation",
        message=msg,
        logger=logger,
    ):
        await standings_recalculation.process_tournament_recalculation_event(data, broker=broker)


@broker.subscriber(SWISS_NEXT_ROUND_QUEUE)
async def process_swiss_next_round(data: dict, msg: RabbitMessage) -> None:
    async with observe_message_processing(
        queue=SWISS_NEXT_ROUND_QUEUE,
        handler="process_swiss_next_round",
        message=msg,
        logger=logger,
    ):
        await process_swiss_next_round_event(data)
