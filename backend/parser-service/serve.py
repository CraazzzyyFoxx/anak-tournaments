from apscheduler.schedulers.asyncio import AsyncIOScheduler
from faststream import FastStream
from faststream.rabbit import RabbitBroker
from shared.clients.s3 import S3Client
from shared.messaging.config import (
    ACHIEVEMENT_EVALUATE_QUEUE,
    PROCESS_MATCH_LOG_QUEUE,
    PROCESS_TOURNAMENT_LOGS_QUEUE,
)
from shared.observability import (
    observe_message_processing,
    publish_message,
    setup_logging,
    setup_tracing,
    start_worker_metrics_server,
)
from shared.schemas.events import (
    AchievementEvaluateEvent,
    ProcessMatchLogEvent,
    ProcessTournamentLogsEvent,
)

from src.core import config, db
from src.services.achievement.engine.consumer import handle_achievement_evaluate
from src.services.admin import balancer_registration as registration_balancer_service
from src.services.match_logs import flows as logs_flows
from src.services.s3 import service as s3_service
from src.services.tournament import flows as tournaments_flows
from src.worker.tasks import encounter as encounter_tasks
from src.worker.tasks import standings as standings_tasks

logger = setup_logging(
    service_name="parser-worker",
    log_level=config.settings.log_level,
    logs_root_path=config.settings.logs_root_path,
    json_output=config.settings.json_logging,
)

broker = RabbitBroker(config.settings.rabbitmq_url, logger=logger)
app = FastStream(broker)

scheduler = AsyncIOScheduler()

s3_client = S3Client(
    access_key=config.settings.s3_access_key,
    secret_key=config.settings.s3_secret_key,
    endpoint_url=config.settings.s3_endpoint_url,
    bucket_name=config.settings.s3_bucket_name,
    public_url=config.settings.s3_public_url,
)


async def sync_registration_google_sheet_feeds() -> None:
    results = await registration_balancer_service.sync_due_google_sheet_feeds(db.async_session_maker)
    if not results:
        return
    logger.info("Registration Google Sheets sync completed", results=results)


@app.on_startup
async def start_scheduler() -> None:
    setup_tracing(
        service_name="parser-worker",
        otlp_endpoint=config.settings.otlp_endpoint,
        enabled=config.settings.tracing_enabled,
        sampler_name=config.settings.otel_traces_sampler,
        sampler_arg=config.settings.otel_traces_sampler_arg,
    )
    start_worker_metrics_server(config.settings.worker_metrics_port)
    await s3_client.start()
    scheduler.add_job(encounter_tasks.bulk_create, "interval", minutes=2, id="encounter_sync")
    scheduler.add_job(standings_tasks.bulk_create_all, "interval", minutes=3, id="standings_sync")
    scheduler.add_job(
        sync_registration_google_sheet_feeds,
        "interval",
        minutes=5,
        id="registration_google_sheet_sync",
    )
    scheduler.start()
    logger.info("Scheduler started: encounter sync every 2m, standings sync every 3m, registration sheet sync every 5m")


@app.on_shutdown
async def stop_scheduler() -> None:
    scheduler.shutdown(wait=False)
    await s3_client.close()


@broker.subscriber(PROCESS_MATCH_LOG_QUEUE)
async def process_match_log_async(data: dict, msg=None) -> None:
    async with observe_message_processing(
        queue=PROCESS_MATCH_LOG_QUEUE,
        handler="process_match_log_async",
        message=msg,
        logger=logger,
    ):
        event = ProcessMatchLogEvent.model_validate(data)
        logger.bind(tournament_id=event.tournament_id, filename=event.filename).info("Processing match log from queue")
        try:
            async with db.async_session_maker() as session:
                await logs_flows.process_match_log(
                    session, event.tournament_id, event.filename, s3_client, is_raise=True
                )
                tournament = await tournaments_flows.get(session, event.tournament_id, [])
                achievement_event = AchievementEvaluateEvent(
                    workspace_id=tournament.workspace_id,
                    tournament_id=event.tournament_id,
                    changed_tables=["matches.statistics", "matches.match", "tournament.encounter"],
                )
                await publish_message(
                    broker,
                    achievement_event.model_dump(),
                    ACHIEVEMENT_EVALUATE_QUEUE,
                    logger=logger.bind(
                        workspace_id=tournament.workspace_id,
                        tournament_id=event.tournament_id,
                    ),
                )
        except Exception:
            logger.exception(
                f"Failed to process match log "
                f"tournament_id={event.tournament_id} filename={event.filename}"
            )
            raise


@broker.subscriber(PROCESS_TOURNAMENT_LOGS_QUEUE)
async def process_tournament_log(data: dict, msg=None) -> None:
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
                tournament = await tournaments_flows.get(session, event.tournament_id, [])
                for log in await s3_service.get_logs_by_tournament(s3_client, tournament.id):
                    await logs_flows.process_match_log(
                        session, tournament.id, log, s3_client, is_raise=False
                    )
            logger.info(f"All logs for tournament {event.tournament_id} are queued for processing.")
        except Exception:
            logger.exception(f"Failed to process tournament logs tournament_id={event.tournament_id}")
            raise


@broker.subscriber(ACHIEVEMENT_EVALUATE_QUEUE)
async def process_achievement_evaluate(data: dict, msg=None) -> None:
    async with observe_message_processing(
        queue=ACHIEVEMENT_EVALUATE_QUEUE,
        handler="process_achievement_evaluate",
        message=msg,
        logger=logger,
    ):
        await handle_achievement_evaluate(data)
