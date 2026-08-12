from __future__ import annotations

import hashlib
from datetime import UTC, datetime, timedelta
from typing import Any
from uuid import uuid4

import sqlalchemy as sa
from sqlalchemy.ext.asyncio import AsyncSession

from shared.clients.s3 import S3Client
from shared.messaging.config import TOURNAMENT_COMPUTE_EXCHANGE
from shared.messaging.outbox import enqueue_outbox_event
from shared.observability import observe_scheduled_job
from src import models, schemas
from src.core import config, db
from src.services.division_grid import marketplace

_ROUTING_KEY = "tournament.compute.division-grid-import"
_STALE_RUNNING_AFTER = timedelta(hours=1)


def _idempotency_key(
    *,
    workspace_id: int,
    source_workspace_id: int,
    source_grid_id: int,
    source_version_id: int,
    include_icons: bool,
    include_ow_rank_mappings: bool,
    source_fingerprint: str,
) -> str:
    raw = ":".join(
        (
            str(workspace_id),
            str(source_workspace_id),
            str(source_grid_id),
            str(source_version_id),
            str(include_icons),
            str(include_ow_rank_mappings),
            source_fingerprint,
        )
    )
    return f"division-grid-import:{hashlib.sha256(raw.encode('utf-8')).hexdigest()}"


async def dispatch_import_job(session: AsyncSession, job: models.DivisionGridImportJob) -> None:
    await enqueue_outbox_event(
        session,
        {"job_id": int(job.id)},
        exchange=TOURNAMENT_COMPUTE_EXCHANGE,
        routing_key=_ROUTING_KEY,
        event_id=uuid4().hex,
        event_type="division_grid_import_job",
    )


async def create_import_job(
    session: AsyncSession,
    *,
    workspace_id: int,
    source_workspace_id: int,
    requested_by_user_id: int | None,
    source_grid_id: int,
    source_version_id: int,
    include_icons: bool,
    include_ow_rank_mappings: bool,
    source_fingerprint: str,
) -> models.DivisionGridImportJob:
    idempotency_key = _idempotency_key(
        workspace_id=workspace_id,
        source_workspace_id=source_workspace_id,
        source_grid_id=source_grid_id,
        source_version_id=source_version_id,
        include_icons=include_icons,
        include_ow_rank_mappings=include_ow_rank_mappings,
        source_fingerprint=source_fingerprint,
    )
    existing = await session.scalar(
        sa.select(models.DivisionGridImportJob).where(models.DivisionGridImportJob.idempotency_key == idempotency_key)
    )
    if existing is not None:
        if getattr(existing, "status", None) == "failed":
            existing.status = "pending"
            existing.progress = 0
            existing.result_json = None
            existing.error = None
            existing.started_at = None
            existing.finished_at = None
            await dispatch_import_job(session, existing)
        return existing

    job = models.DivisionGridImportJob(
        workspace_id=workspace_id,
        source_workspace_id=source_workspace_id,
        requested_by_user_id=requested_by_user_id,
        status="pending",
        progress=0,
        request_json={
            "source_grid_id": source_grid_id,
            "source_version_id": source_version_id,
            "include_icons": include_icons,
            "include_ow_rank_mappings": include_ow_rank_mappings,
            "source_fingerprint": source_fingerprint,
        },
        idempotency_key=idempotency_key,
    )
    session.add(job)
    await session.flush()
    await dispatch_import_job(session, job)
    return job


def to_read(job: models.DivisionGridImportJob) -> schemas.DivisionGridImportJobRead:
    result = (
        schemas.DivisionGridMarketplaceImportResult.model_validate(job.result_json)
        if job.result_json is not None
        else None
    )
    return schemas.DivisionGridImportJobRead(
        id=job.id,
        workspace_id=job.workspace_id,
        source_workspace_id=job.source_workspace_id,
        requested_by_user_id=job.requested_by_user_id,
        status=job.status,
        progress=job.progress,
        result=result,
        error=job.error,
        created_at=job.created_at,
        started_at=job.started_at,
        finished_at=job.finished_at,
    )


async def get_import_job(
    session: AsyncSession,
    *,
    workspace_id: int,
    job_id: int,
) -> models.DivisionGridImportJob | None:
    return await session.scalar(
        sa.select(models.DivisionGridImportJob).where(
            models.DivisionGridImportJob.id == job_id,
            models.DivisionGridImportJob.workspace_id == workspace_id,
        )
    )


async def list_import_jobs(
    session: AsyncSession,
    *,
    workspace_id: int,
    active_only: bool = False,
    limit: int = 20,
) -> list[models.DivisionGridImportJob]:
    statement = sa.select(models.DivisionGridImportJob).where(models.DivisionGridImportJob.workspace_id == workspace_id)
    if active_only:
        statement = statement.where(models.DivisionGridImportJob.status.in_(("pending", "running")))
    result = await session.scalars(
        statement.order_by(models.DivisionGridImportJob.id.desc()).limit(max(1, min(limit, 100)))
    )
    return list(result.all())


def _new_s3_client() -> S3Client:
    return S3Client(
        access_key=config.settings.s3_access_key,
        secret_key=config.settings.s3_secret_key,
        endpoint_url=config.settings.s3_endpoint_url,
        bucket_name=config.settings.s3_bucket_name,
        public_url=config.settings.s3_public_url,
    )


async def recover_stale_import_jobs() -> int:
    """Requeue imports abandoned by a worker after its lease window."""
    cutoff = datetime.now(UTC) - _STALE_RUNNING_AFTER
    async with observe_scheduled_job("division_grid_import_recovery"), db.async_session_maker() as session:
        jobs = await session.scalars(
            sa.select(models.DivisionGridImportJob).where(
                models.DivisionGridImportJob.status == "running",
                models.DivisionGridImportJob.started_at < cutoff,
            )
        )
        stale_jobs = list(jobs.all())
        for job in stale_jobs:
            job.status = "pending"
            job.progress = 0
            job.started_at = None
            job.finished_at = None
            job.error = "Previous worker stopped before the import completed; retrying"
            await dispatch_import_job(session, job)
        if stale_jobs:
            await session.commit()
        return len(stale_jobs)


async def process_import_job(job_id: int) -> None:
    async with db.async_session_maker() as session:
        claimed_id = await session.scalar(
            sa.update(models.DivisionGridImportJob)
            .where(
                models.DivisionGridImportJob.id == job_id,
                models.DivisionGridImportJob.status == "pending",
            )
            .values(
                status="running",
                progress=10,
                error=None,
                started_at=datetime.now(UTC),
                finished_at=None,
            )
            .returning(models.DivisionGridImportJob.id)
        )
        if claimed_id is None:
            return
        await session.commit()

        job = await session.get(models.DivisionGridImportJob, job_id)
        if job is None:
            return
        payload: dict[str, Any] = dict(job.request_json)
        s3 = _new_s3_client()
        try:
            await s3.start()
            target_workspace = await session.get(models.Workspace, job.workspace_id)
            source_workspace = await session.get(models.Workspace, job.source_workspace_id)
            if target_workspace is None or source_workspace is None:
                raise RuntimeError("Source or target workspace no longer exists")

            source_grids = await marketplace.get_marketplace_grids_by_ids(
                session,
                source_workspace_id=source_workspace.id,
                source_grid_ids=[payload["source_grid_id"]],
            )
            job.progress = 35
            await session.flush()
            result = await marketplace.import_division_grids(
                session,
                s3,
                target_workspace=target_workspace,
                source_workspace=source_workspace,
                source_grids=source_grids,
                mode="copy",
                expected_source_fingerprint=payload["source_fingerprint"],
                source_version_id=payload["source_version_id"],
                include_icons=payload["include_icons"],
                include_ow_rank_mappings=payload["include_ow_rank_mappings"],
            )
            job.status = "completed"
            job.progress = 100
            job.result_json = result.model_dump(mode="json")
            job.finished_at = datetime.now(UTC)
            await session.commit()
        except Exception as exc:
            await session.rollback()
            failed_job = await session.get(models.DivisionGridImportJob, job_id)
            if failed_job is not None:
                failed_job.status = "failed"
                failed_job.error = str(exc)[:2000]
                failed_job.finished_at = datetime.now(UTC)
                await session.commit()
            raise
        finally:
            await s3.close()
