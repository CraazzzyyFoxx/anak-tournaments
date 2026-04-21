from __future__ import annotations

from fastapi import APIRouter, Depends, File, Form, Header, HTTPException, Query, Request, UploadFile, status
from fastapi.responses import StreamingResponse
from faststream.rabbit.fastapi import RabbitRouter
from loguru import logger

from src import models
from src.composition import build_public_http_use_cases
from src.core.auth import get_current_active_user
from src.core.config import config
from src.schemas import BalanceJobResult, BalancerConfigResponse, CreateJobResponse, JobStatusResponse

router = APIRouter(
    prefix="",
    tags=["Balancer"],
)
task_router = RabbitRouter(config.rabbitmq_url, logger=logger)
use_cases = build_public_http_use_cases(broker=task_router.broker, logger=logger)


@router.post("/jobs", response_model=CreateJobResponse, status_code=status.HTTP_202_ACCEPTED)
async def create_balancer_job(
    player_data_file: UploadFile = File(..., description="File containing player data/commands"),
    config_overrides: str | None = Form(None, description="JSON object with balancing config overrides"),
    workspace_id: int = Query(..., description="Workspace context for authorization"),
    user: models.AuthUser = Depends(get_current_active_user),
) -> CreateJobResponse:
    try:
        return await use_cases.create_job.execute(
            uploaded_file=player_data_file,
            raw_config=config_overrides,
            workspace_id=workspace_id,
            user=user,
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


@router.post("/balance", response_model=CreateJobResponse, status_code=status.HTTP_202_ACCEPTED)
async def balance_tournament_teams(
    player_data_file: UploadFile = File(..., description="File containing player data/commands"),
    config_overrides: str | None = Form(None, description="JSON object with balancing config overrides"),
    workspace_id: int = Query(..., description="Workspace context for authorization"),
    user: models.AuthUser = Depends(get_current_active_user),
) -> CreateJobResponse:
    try:
        return await use_cases.create_job.execute(
            uploaded_file=player_data_file,
            raw_config=config_overrides,
            workspace_id=workspace_id,
            user=user,
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


@router.get("/jobs/{job_id}", response_model=JobStatusResponse, status_code=status.HTTP_200_OK)
async def get_balancer_job_status(
    job_id: str,
    user: models.AuthUser = Depends(get_current_active_user),
) -> JobStatusResponse:
    return await use_cases.get_job_status.execute(job_id=job_id, user=user)


@router.get("/jobs/{job_id}/result", response_model=BalanceJobResult, status_code=status.HTTP_200_OK)
async def get_balancer_job_result(
    job_id: str,
    user: models.AuthUser = Depends(get_current_active_user),
) -> BalanceJobResult:
    return await use_cases.get_job_result.execute(job_id=job_id, user=user)


@router.get("/jobs/{job_id}/stream", status_code=status.HTTP_200_OK)
async def stream_balancer_job_events(
    request: Request,
    job_id: str,
    after_event_id: int = Query(default=0, ge=0),
    last_event_id: str | None = Header(default=None, alias="Last-Event-ID"),
    user: models.AuthUser = Depends(get_current_active_user),
) -> StreamingResponse:
    event_generator = await use_cases.stream_job_events.execute(
        request=request,
        job_id=job_id,
        after_event_id=after_event_id,
        last_event_id=last_event_id,
        user=user,
    )
    return StreamingResponse(
        event_generator,
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@router.get("/config", response_model=BalancerConfigResponse, status_code=status.HTTP_200_OK)
async def get_balancer_config() -> dict:
    return use_cases.get_config.execute()
