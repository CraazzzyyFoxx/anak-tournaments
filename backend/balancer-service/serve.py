import asyncio
from typing import Any

from faststream import FastStream
from faststream.rabbit import RabbitBroker
from pydantic import ValidationError
from src.core.config import config
from src.core.job_store import JobStatus, get_job_store
from src.service import balance_teams

from shared.messaging.config import BALANCER_JOBS_QUEUE
from shared.observability import setup_logging
from shared.schemas.events import BalancerJobEvent

# Setup structured logging for this standalone FastStream worker.
# This runs separately from main.py (FastAPI), so it must call setup_logging() itself.
logger = setup_logging(
    service_name="balancer-worker",
    log_level=config.log_level,
    logs_root_path=config.LOGS_ROOT_PATH,
    json_output=config.JSON_LOGGING,
)

broker = RabbitBroker(config.RABBITMQ_URL, logger=logger)
app = FastStream(broker)


@broker.subscriber(BALANCER_JOBS_QUEUE)
async def process_balancer_job(body: dict[str, Any]) -> None:
    try:
        event = BalancerJobEvent.model_validate(body)
    except ValidationError as exc:
        logger.error(f"Invalid balancer job payload: {exc}")
        return

    job_store = get_job_store()

    payload = await job_store.get_job_payload(event.job_id)
    if payload is None:
        logger.error(f"Job payload missing for job_id={event.job_id}")
        return

    current_meta = await job_store.get_job_meta(event.job_id)
    if current_meta and current_meta.get("status") in {"succeeded", "failed"}:
        logger.info(f"Skipping already completed balancer job {event.job_id}")
        return

    await job_store.mark_running(event.job_id)

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
        config_overrides = payload.get("config")

        if not isinstance(input_data, dict):
            raise ValueError("Job payload does not contain valid player data")

        result = await asyncio.to_thread(balance_teams, input_data, config_overrides, progress_callback)

        await event_queue.put(None)
        await consume_task

        await job_store.mark_succeeded(event.job_id, result)
        logger.success(f"Balancer job completed: {event.job_id}")
    except Exception as exc:  # pragma: no cover - defensive worker guard
        logger.exception(f"Balancer job failed ({event.job_id}): {exc}")

        await event_queue.put(None)
        await consume_task

        await job_store.mark_failed(event.job_id, f"Balancer job failed: {exc}")
