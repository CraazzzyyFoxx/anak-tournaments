import asyncio
import json
from json import JSONDecodeError

from fastapi import APIRouter, Depends, File, Form, Header, HTTPException, Query, Request, UploadFile, status
from fastapi.responses import StreamingResponse
from faststream.rabbit.fastapi import RabbitRouter
from loguru import logger
from pydantic import ValidationError
from src.core.config import config
from src.core.auth import require_any_role
from src.core.job_store import get_job_store
from src.schemas import (
    BalancerConfigResponse,
    BalanceJobResult,
    BalanceResponse,
    ConfigOverrides,
    CreateJobResponse,
    JobStatusResponse,
)
from src.service import get_balancer_config_payload

from shared.messaging.config import BALANCER_JOBS_QUEUE
from shared.schemas.events import BalancerJobEvent

router = APIRouter(
    prefix="",
    tags=["Balancer"],
    dependencies=[Depends(require_any_role("admin", "tournament_organizer"))],
)
task_router = RabbitRouter(config.RABBITMQ_URL, logger=logger)

TERMINAL_STATUSES = {"succeeded", "failed"}


def parse_config_overrides(config_raw: str | None) -> dict | None:
    """Parse and validate config overrides from multipart form data."""
    if not config_raw:
        return None

    try:
        payload = json.loads(config_raw)
    except JSONDecodeError as exc:
        raise ValueError(f"Invalid JSON in 'config' field: {exc}") from exc

    if isinstance(payload, dict) and isinstance(payload.get("config"), dict):
        payload = payload["config"]

    if not isinstance(payload, dict):
        raise ValueError("'config' field must contain a JSON object")

    try:
        validated = ConfigOverrides.model_validate(payload)
    except ValidationError as exc:
        raise ValueError(f"Invalid config overrides: {exc.errors()}") from exc

    return validated.model_dump(exclude_none=True)


async def parse_player_data_from_file(file: UploadFile | None) -> dict:
    if not file:
        raise ValueError("'file' parameter must be provided")

    logger.info(f"Processing uploaded file: {file.filename}")
    content = await file.read()
    try:
        player_data = json.loads(content.decode("utf-8"))
    except json.JSONDecodeError as exc:
        raise ValueError(f"Invalid JSON in uploaded file: {exc}") from exc

    logger.info("Successfully parsed data from uploaded file")
    return player_data


def build_job_urls(job_id: str) -> dict[str, str]:
    return {
        "status_url": f"/api/balancer/jobs/{job_id}",
        "result_url": f"/api/balancer/jobs/{job_id}/result",
        "stream_url": f"/api/balancer/jobs/{job_id}/stream",
    }


async def enqueue_balancer_job(file: UploadFile | None, config_raw: str | None) -> CreateJobResponse:
    logger.info("Received balancer job creation request")

    player_data = await parse_player_data_from_file(file)
    config_overrides = parse_config_overrides(config_raw)

    job_store = get_job_store()
    job_id = await job_store.create_job(player_data, config_overrides)

    try:
        event = BalancerJobEvent(job_id=job_id)
        await task_router.broker.publish(event.model_dump(), BALANCER_JOBS_QUEUE)
        logger.success(f"Balancer job queued: {job_id}")
    except Exception as exc:  # pragma: no cover - network/broker failure path
        logger.exception(f"Failed to enqueue balancer job {job_id}")
        await job_store.mark_failed(job_id, f"Failed to enqueue balancer job: {exc}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to enqueue balancer job",
        ) from exc

    urls = build_job_urls(job_id)
    return CreateJobResponse(job_id=job_id, status="queued", **urls)


@router.post("/jobs", response_model=CreateJobResponse, status_code=status.HTTP_202_ACCEPTED)
async def create_balancer_job(
    file: UploadFile = File(..., description="File containing player data/commands"),
    config: str | None = Form(None, description="JSON object with balancing config overrides"),
) -> CreateJobResponse:
    try:
        return await enqueue_balancer_job(file, config)
    except ValueError as exc:
        logger.warning(f"Validation error during job creation: {exc}")
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


@router.post("/balance", response_model=CreateJobResponse, status_code=status.HTTP_202_ACCEPTED)
async def balance_tournament_teams(
    file: UploadFile = File(..., description="File containing player data/commands"),
    config: str | None = Form(None, description="JSON object with balancing config overrides"),
) -> CreateJobResponse:
    """Backward-compatible alias for creating a balancer async job."""
    try:
        return await enqueue_balancer_job(file, config)
    except ValueError as exc:
        logger.warning(f"Validation error during job creation: {exc}")
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


@router.get("/jobs/{job_id}", response_model=JobStatusResponse, status_code=status.HTTP_200_OK)
async def get_balancer_job_status(job_id: str) -> dict:
    job_store = get_job_store()
    meta = await job_store.get_job_meta(job_id)
    if meta is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Balancer job not found")
    return meta


@router.get("/jobs/{job_id}/result", response_model=BalanceJobResult, status_code=status.HTTP_200_OK)
async def get_balancer_job_result(job_id: str) -> dict:
    job_store = get_job_store()
    meta = await job_store.get_job_meta(job_id)
    if meta is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Balancer job not found")

    status_value = meta.get("status")
    if status_value == "failed":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=meta.get("error") or "Balancer job failed",
        )
    if status_value != "succeeded":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Balancer job is still {status_value}",
        )

    result = await job_store.get_job_result(job_id)
    if result is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Balancer job result not found")
    return result


@router.get("/jobs/{job_id}/stream", status_code=status.HTTP_200_OK)
async def stream_balancer_job_events(
    request: Request,
    job_id: str,
    after_event_id: int = Query(default=0, ge=0),
    last_event_id: str | None = Header(default=None, alias="Last-Event-ID"),
) -> StreamingResponse:
    job_store = get_job_store()
    meta = await job_store.get_job_meta(job_id)
    if meta is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Balancer job not found")

    cursor = after_event_id
    if last_event_id and last_event_id.isdigit():
        cursor = max(cursor, int(last_event_id))

    async def event_generator():
        next_cursor = cursor

        while True:
            if await request.is_disconnected():
                break

            events = await job_store.get_events_since(job_id, next_cursor)
            for event in events:
                next_cursor = max(next_cursor, int(event["event_id"]))
                yield f"id: {event['event_id']}\ndata: {json.dumps(event, ensure_ascii=False)}\n\n"

            current_meta = await job_store.get_job_meta(job_id)
            if current_meta is None:
                break

            if current_meta.get("status") in TERMINAL_STATUSES and not events:
                break

            yield ": heartbeat\n\n"
            await asyncio.sleep(1)

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@router.get("/config", response_model=BalancerConfigResponse, status_code=status.HTTP_200_OK)
async def get_balancer_config() -> dict:
    """Get balancer defaults, limits, and presets for frontend settings."""
    return get_balancer_config_payload()
