"""Admin routes for log processing monitoring: history, queue status, and SSE stream."""

import asyncio
import json
from datetime import datetime, timezone

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import EventSourceResponse
from fastapi.sse import ServerSentEvent
from loguru import logger
from pydantic import BaseModel
from sqlalchemy import desc, select
from sqlalchemy.ext.asyncio import AsyncSession

import main
from shared.messaging.config import PROCESS_MATCH_LOG_QUEUE
from shared.models.log_processing import LogProcessingStatus
from shared.schemas.events import ProcessMatchLogEvent
from src import models
from src.core import auth, config, db
from src.routes.match_logs import task_router

router = APIRouter(
    prefix="/logs",
    tags=["admin", "logs"],
)

MONITORED_QUEUES = [
    "process_match_log",
    "process_tournament_logs",
    "discord_commands",
    "balancer_jobs",
]


# ─── Response schemas ────────────────────────────────────────────────────────


class QueueDepth(BaseModel):
    name: str
    messages_ready: int
    messages_unacknowledged: int
    consumers: int
    status: str = "ok"  # "ok" | "not_found" | "error"


class LogRecordRead(BaseModel):
    id: int
    tournament_id: int
    tournament_name: str | None
    filename: str
    status: str
    source: str
    uploader_name: str | None
    error_message: str | None
    created_at: datetime
    started_at: datetime | None
    finished_at: datetime | None

    model_config = {"from_attributes": True}


class LogHistoryResponse(BaseModel):
    items: list[LogRecordRead]
    total: int


# ─── Helpers ─────────────────────────────────────────────────────────────────


async def _fetch_queue_depths() -> list[QueueDepth]:
    """Query RabbitMQ Management API for queue depths."""
    cfg = config.settings
    base = cfg.rabbitmq_management_url.rstrip("/")
    auth_tuple = (cfg.rabbitmq_management_user, cfg.rabbitmq_management_password)
    depths: list[QueueDepth] = []
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            for queue_name in MONITORED_QUEUES:
                url = f"{base}/api/queues/%2F/{queue_name}"
                resp = await client.get(url, auth=auth_tuple)
                if resp.status_code == 200:
                    data = resp.json()
                    depths.append(
                        QueueDepth(
                            name=queue_name,
                            messages_ready=data.get("messages_ready", 0),
                            messages_unacknowledged=data.get("messages_unacknowledged", 0),
                            consumers=data.get("consumers", 0),
                        )
                    )
                elif resp.status_code == 404:
                    depths.append(QueueDepth(name=queue_name, messages_ready=-1, messages_unacknowledged=-1, consumers=0, status="not_found"))
                else:
                    depths.append(QueueDepth(name=queue_name, messages_ready=-1, messages_unacknowledged=-1, consumers=0, status="error"))
    except Exception as exc:
        logger.warning(f"Failed to fetch queue depths from RabbitMQ management API: {exc}")
        for queue_name in MONITORED_QUEUES:
            depths.append(QueueDepth(name=queue_name, messages_ready=-1, messages_unacknowledged=-1, consumers=0, status="error"))
    return depths


def _record_to_dict(record: models.LogProcessingRecord) -> dict:
    return {
        "id": record.id,
        "tournament_id": record.tournament_id,
        "tournament_name": record.tournament.name if record.tournament else None,
        "filename": record.filename,
        "status": record.status.value if hasattr(record.status, "value") else record.status,
        "source": record.source.value if hasattr(record.source, "value") else record.source,
        "uploader_name": record.uploader.name if record.uploader else None,
        "error_message": record.error_message,
        "created_at": record.created_at.isoformat() if record.created_at else None,
        "started_at": record.started_at.isoformat() if record.started_at else None,
        "finished_at": record.finished_at.isoformat() if record.finished_at else None,
    }


async def _fetch_recent_records(session: AsyncSession, limit: int = 20, workspace_id: int | None = None) -> list[dict]:
    query = select(models.LogProcessingRecord).order_by(desc(models.LogProcessingRecord.created_at))
    if workspace_id is not None:
        query = query.join(models.Tournament, models.LogProcessingRecord.tournament_id == models.Tournament.id).where(
            models.Tournament.workspace_id == workspace_id
        )
    result = await session.execute(query.limit(limit))
    return [_record_to_dict(r) for r in result.scalars().all()]


# ─── Routes ──────────────────────────────────────────────────────────────────


@router.get(
    "/queue-status",
    response_model=list[QueueDepth],
    dependencies=[Depends(auth.require_any_role("admin", "tournament_organizer"))],
)
async def get_queue_status():
    """Get current RabbitMQ queue depths for all monitored queues."""
    return await _fetch_queue_depths()


@router.get(
    "/history",
    dependencies=[Depends(auth.require_any_role("admin", "tournament_organizer"))],
)
async def get_log_history(
    tournament_id: int | None = Query(None),
    workspace_id: int | None = Query(None),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    session: AsyncSession = Depends(db.get_async_session),
):
    """Get paginated log processing history, optionally filtered by tournament or workspace."""
    query = select(models.LogProcessingRecord).order_by(desc(models.LogProcessingRecord.created_at))
    count_query = select(models.LogProcessingRecord.id)

    if tournament_id is not None:
        query = query.where(models.LogProcessingRecord.tournament_id == tournament_id)
        count_query = count_query.where(models.LogProcessingRecord.tournament_id == tournament_id)
    if workspace_id is not None:
        query = query.join(
            models.Tournament, models.LogProcessingRecord.tournament_id == models.Tournament.id
        ).where(models.Tournament.workspace_id == workspace_id)
        count_query = count_query.join(
            models.Tournament, models.LogProcessingRecord.tournament_id == models.Tournament.id
        ).where(models.Tournament.workspace_id == workspace_id)

    count_result = await session.execute(count_query)
    total = len(count_result.scalars().all())

    result = await session.execute(query.limit(limit).offset(offset))
    items = [_record_to_dict(r) for r in result.scalars().all()]
    return {"items": items, "total": total}


@router.post(
    "/{record_id}/retry",
    response_model=LogRecordRead,
    dependencies=[Depends(auth.require_any_role("admin", "tournament_organizer"))],
)
async def retry_log_record(
    record_id: int,
    session: AsyncSession = Depends(db.get_async_session),
):
    """Reset a failed/pending log record to pending and re-queue it for processing."""
    result = await session.execute(
        select(models.LogProcessingRecord).where(models.LogProcessingRecord.id == record_id)
    )
    record = result.scalar_one_or_none()
    if record is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Log processing record not found")

    record.status = LogProcessingStatus.pending
    record.error_message = None
    record.started_at = None
    record.finished_at = None
    await session.commit()
    await session.refresh(record)

    event = ProcessMatchLogEvent(tournament_id=record.tournament_id, filename=record.filename)
    await task_router.broker.publish(event.model_dump(), PROCESS_MATCH_LOG_QUEUE)

    return LogRecordRead.model_validate(_record_to_dict(record))


async def _require_sse_token(token: str = Query(..., description="JWT access token")) -> None:
    """Dependency that validates the SSE token query param (EventSource can't send headers)."""
    payload = await main.auth_client.validate_token(token)
    if not payload:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")


@router.get("/stream", response_class=EventSourceResponse, dependencies=[Depends(_require_sse_token)])
async def stream_log_status(
    token: str = Query(..., description="JWT access token for authentication"),
    workspace_id: int | None = Query(None, description="Filter recent logs by workspace"),
):
    """SSE stream: emits queue depths + recent log processing updates every 2 seconds.

    The endpoint must be an async generator so FastAPI's native SSE machinery can
    iterate it directly.  A regular ``async def`` that *returns* a generator causes
    Starlette to try ``iter(<coroutine>)`` which raises TypeError.
    """
    async with db.async_session_maker() as session:
        # Initial keepalive so the browser knows the connection is open
        yield ServerSentEvent(comment="connected")

        while True:
            try:
                queues = await _fetch_queue_depths()
                recent = await _fetch_recent_records(session, limit=20, workspace_id=workspace_id)

                payload_data = {
                    "timestamp": datetime.now(timezone.utc).isoformat(),
                    "queues": [q.model_dump() for q in queues],
                    "recent_logs": recent,
                }
                yield ServerSentEvent(data=payload_data, event="update")
            except asyncio.CancelledError:
                return
            except Exception as exc:
                logger.warning(f"SSE stream error: {exc}")
                yield ServerSentEvent(data={"error": str(exc)}, event="error")

            await asyncio.sleep(2)
