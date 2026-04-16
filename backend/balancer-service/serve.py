import asyncio
from typing import Any

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from faststream import FastStream
from faststream.rabbit import RabbitBroker
from pydantic import ValidationError
from src.core.config import config
from src.core import db
from src.core.job_store import JobStatus, get_job_store

# New universal adapters (used alongside legacy paths during transition)
from src.cpsat_bridge import run_cpsat
from src.service import balance_teams
from src.services.admin import balancer_registration as registration_balancer_service

from shared.messaging.config import BALANCER_JOBS_QUEUE
from shared.observability import (
    observe_message_processing,
    setup_logging,
    setup_tracing,
    start_worker_metrics_server,
)
from shared.schemas.events import BalancerJobEvent

logger = setup_logging(
    service_name="balancer-worker",
    log_level=config.log_level,
    logs_root_path=config.logs_root_path,
    json_output=config.json_logging,
)

broker = RabbitBroker(config.rabbitmq_url, logger=logger)
app = FastStream(broker)
scheduler = AsyncIOScheduler()


async def sync_registration_google_sheet_feeds() -> None:
    results = await registration_balancer_service.sync_due_google_sheet_feeds(db.async_session_maker)
    if not results:
        return
    logger.info("Registration Google Sheets sync completed", results=results)


@app.on_startup
async def setup_worker_observability() -> None:
    setup_tracing(
        service_name="balancer-worker",
        otlp_endpoint=config.otlp_endpoint,
        enabled=config.tracing_enabled,
        sampler_name=config.otel_traces_sampler,
        sampler_arg=config.otel_traces_sampler_arg,
    )
    start_worker_metrics_server(config.worker_metrics_port)
    scheduler.add_job(
        sync_registration_google_sheet_feeds,
        "interval",
        minutes=5,
        id="registration_google_sheet_sync",
    )
    scheduler.start()
    logger.info("Scheduler started: registration sheet sync every 5m")


@app.on_shutdown
async def stop_scheduler() -> None:
    scheduler.shutdown(wait=False)


@broker.subscriber(BALANCER_JOBS_QUEUE)
async def process_balancer_job(body: dict[str, Any], msg=None) -> None:
    logger.info("Balancer worker: entered process_balancer_job handler")
    try:
        logger.info("Balancer worker: validating job payload envelope")
        event = BalancerJobEvent.model_validate(body)
        logger.info(f"Balancer worker: envelope validated for job_id={event.job_id}")
    except ValidationError as exc:
        # observation.set_status("invalid")
        logger.error(f"Invalid balancer job payload: {exc}")
        return

    logger.info(f"Balancer worker: acquiring job store for job_id={event.job_id}")
    job_store = get_job_store()
    logger.info(f"Balancer worker: job store ready for job_id={event.job_id}")

    logger.info(f"Balancer worker: loading job payload for job_id={event.job_id}")
    payload = await job_store.get_job_payload(event.job_id)
    logger.info(
        "Balancer worker: job payload lookup finished for job_id={} payload_found={}",
        event.job_id,
        payload is not None,
    )
    if payload is None:
        # observation.set_status("missing_payload")
        logger.error(f"Job payload missing for job_id={event.job_id}")
        return

    logger.info(f"Balancer worker: loading job meta for job_id={event.job_id}")
    current_meta = await job_store.get_job_meta(event.job_id)
    logger.info(
        "Balancer worker: job meta lookup finished for job_id={} status={}",
        event.job_id,
        current_meta.get("status") if current_meta else None,
    )
    if current_meta and current_meta.get("status") in {"succeeded", "failed"}:
        # observation.set_status("already_completed")
        logger.info(f"Skipping already completed balancer job {event.job_id}")
        return

    logger.info(f"Balancer worker: marking job running for job_id={event.job_id}")
    await job_store.mark_running(event.job_id)
    logger.info(f"Balancer worker: job marked running for job_id={event.job_id}")

    event_queue: asyncio.Queue[dict[str, Any] | None] = asyncio.Queue()
    loop = asyncio.get_running_loop()

    def progress_callback(progress_payload: dict[str, Any]) -> None:
        loop.call_soon_threadsafe(event_queue.put_nowait, progress_payload)

    async def consume_progress_events() -> None:
        while True:
            update = await event_queue.get()
            if update is None:
                break

            stage = str(update.get("stage", "running"))
            status_value = str(update.get("status", "running"))
            if status_value == "queued":
                status: JobStatus = "queued"
            elif status_value == "succeeded":
                status = "succeeded"
            elif status_value == "failed":
                status = "failed"
            else:
                status = "running"
            message = str(update.get("message", ""))
            level = str(update.get("level", "info"))
            progress = update.get("progress")

            await job_store.append_event(
                event.job_id,
                status=status,
                stage=stage,
                message=message,
                level=level,
                progress=progress,
                update_meta=True,
            )

    consume_task = asyncio.create_task(consume_progress_events())

    try:
        input_data = payload.get("data")
        config_overrides = payload.get("config") or {}

        if not isinstance(input_data, dict):
            raise ValueError("Job payload does not contain valid player data")

        algorithm = config_overrides.get("ALGORITHM", "genetic") if config_overrides else "genetic"

        if algorithm == "cpsat":
            max_solutions = config_overrides.get("MAX_CPSAT_SOLUTIONS", 3) if config_overrides else 3
            await job_store.append_event(
                event.job_id,
                status="running",
                stage="solving",
                message="Running CP-SAT solver…",
                level="info",
                progress=None,
                update_meta=True,
            )
            variants = await asyncio.to_thread(run_cpsat, input_data, max_solutions)
            result = {"variants": variants}
        else:
            result_single = await asyncio.to_thread(balance_teams, input_data, config_overrides, progress_callback)
            result = {"variants": [result_single]}

        await event_queue.put(None)
        await consume_task

        await job_store.mark_succeeded(event.job_id, result)
        logger.success(f"Balancer job completed: {event.job_id}")
    except Exception as exc:  # pragma: no cover - defensive worker guard
        logger.exception(f"Balancer job failed ({event.job_id}): {exc}")

        await event_queue.put(None)
        await consume_task

        await job_store.mark_failed(event.job_id, f"Balancer job failed: {exc}")
        raise
