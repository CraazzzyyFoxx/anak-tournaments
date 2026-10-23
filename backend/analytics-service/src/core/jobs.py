"""Analytics wiring for ``shared.jobs.JobService``.

Kind check, failed-stage reconcile, and stage-progress JSON stay here; lifecycle create/get/list/mark lives on
``job_runtime``. The admission gates and ``create_analytics_job`` are shared by job-control
(``rpc.analytics.create_job``) and the worker's automatic compute on tournament completion.
"""

from __future__ import annotations

import typing
from collections.abc import Sequence
from datetime import UTC, datetime

from sqlalchemy.ext.asyncio import AsyncSession

from shared import models
from shared.core.errors import BaseAPIException as HTTPException
from shared.domain.workspace_tier import is_verified_or_trusted
from shared.jobs import JobConflict, JobService, JobSpec, OneActive, OrmJobStore, Status
from shared.messaging.config import ANALYTICS_JOB_QUEUE
from shared.messaging.outbox import enqueue_outbox_event
from shared.repository import AnalyticsJobRepository, TournamentRepository, WorkspaceRepository
from shared.schemas.events import AnalyticsJobRequested
from src.core.analytics_exports import supports_analytics
from src.worker.job_realtime import emit_job_event

__all__ = (
    "JOB_KIND_COMPUTE",
    "JOB_KIND_TRAIN_ML",
    "JOB_KINDS",
    "JOB_STATUS_FAILED",
    "JOB_STATUS_PENDING",
    "JOB_STATUS_RUNNING",
    "JOB_STATUS_SUCCEEDED",
    "create_analytics_job",
    "job_runtime",
    "reconcile_and_get_active_job",
    "reconcile_failed_active_jobs",
    "require_analytics_owner",
    "require_verified_workspace",
    "update_progress",
)

JOB_KIND_COMPUTE = "compute"
JOB_KIND_TRAIN_ML = "train_ml"
JOB_KINDS = (JOB_KIND_COMPUTE, JOB_KIND_TRAIN_ML)

JOB_STATUS_PENDING = Status.PENDING
JOB_STATUS_RUNNING = Status.RUNNING
JOB_STATUS_SUCCEEDED = Status.SUCCEEDED
JOB_STATUS_FAILED = Status.FAILED

_ACTIVE = (Status.PENDING, Status.RUNNING)

_repo = AnalyticsJobRepository()
_workspaces = WorkspaceRepository()
_tournaments = TournamentRepository()
job_runtime: JobService = JobService(
    store=OrmJobStore(
        repo=_repo,
        model=models.AnalyticsJob,
        created_status=Status.PENDING,
        active_statuses=_ACTIVE,
    ),
    concurrency=OneActive(),
)


async def require_verified_workspace(session: AsyncSession, workspace_id: int | None) -> None:
    """GPU gate: a workspace-scoped compute/train/infer job only runs for a
    verified or trusted workspace. Global (``workspace_id is None``) jobs are
    superuser/global-permission territory and stay ungated."""
    if workspace_id is None:
        return
    workspace = await _workspaces.get(session, workspace_id)
    if workspace is None or not is_verified_or_trusted(workspace):
        raise HTTPException(status_code=403, detail="workspace_not_verified")


async def require_analytics_owner(
    session: AsyncSession, tournament_id: int, *, scope: Sequence[int] | None = None, models_required: bool = True
) -> None:
    """The tournament must belong to ``scope`` (the workspaces the request names) -- always, since a job for a
    tournament of another workspace would recompute and replace that workspace's rows. With ``models_required``
    (explicit model/training requests) its discipline must also declare analytics models. Either failure is a 422
    raised before any job is admitted or any quota is charged. An unknown tournament is left to the job itself."""
    owner = await _tournaments.get_owner(session, tournament_id)
    if owner is None:
        return
    workspace_id, code = owner
    if scope is not None and workspace_id not in {int(w) for w in scope}:
        raise HTTPException(status_code=422, detail="tournament does not belong to the requested workspace scope")
    if models_required and not supports_analytics(code):
        raise HTTPException(status_code=422, detail=f"discipline {code!r} declares no analytics models")


def _progress_has_failed_stage(progress: dict[str, typing.Any] | None) -> bool:
    if not isinstance(progress, dict):
        return False
    return any(isinstance(stage, dict) and stage.get("state") == JOB_STATUS_FAILED for stage in progress.values())


async def reconcile_failed_active_jobs(session: AsyncSession, workspace_id: int | None) -> None:
    """Mark FAILED, and commit, every pending/running job whose progress already records a failed stage.

    A worker that dies after writing a failed stage leaves the row active, and ``OneActive`` would then refuse every
    new job for the workspace; this is the repair, run before each read or create of the active slot.
    """
    active = await _repo.list_active(session, workspace_id, _ACTIVE)
    repaired = False
    for job in active:
        if not _progress_has_failed_stage(job.progress):
            continue
        job.status = JOB_STATUS_FAILED
        job.error = job.error or "Analytics job had failed progress but active status; reconciled automatically."
        job.finished_at = datetime.now(UTC)
        repaired = True
    if repaired:
        await session.flush()
        await session.commit()


async def reconcile_and_get_active_job(session: AsyncSession, workspace_id: int | None) -> models.AnalyticsJob | None:
    """The workspace's active job, after :func:`reconcile_failed_active_jobs` (a write that commits) has run."""
    await reconcile_failed_active_jobs(session, workspace_id)
    return await job_runtime.get_active(session, workspace_id)


async def create_analytics_job(
    session: AsyncSession,
    *,
    workspace_id: int | None,
    tournament_id: int,
    kind: str,
    algorithms: list[str] | None,
    training_workspace_ids: list[int] | None = None,
    requested_by_user_id: int | None,
) -> models.AnalyticsJob:
    if kind not in JOB_KINDS:
        raise ValueError(f"unknown job kind: {kind!r}")
    await reconcile_failed_active_jobs(session, workspace_id)
    spec = JobSpec(
        kind=kind,
        workspace_id=workspace_id,
        extra={
            "tournament_id": tournament_id,
            "requested_by_user_id": requested_by_user_id,
            "algorithms": list(algorithms) if algorithms else None,
            "training_workspace_ids": (
                sorted({int(wid) for wid in training_workspace_ids}) if training_workspace_ids is not None else None
            ),
            "progress": {},
        },
    )
    try:
        job = await job_runtime.create(session, spec)
    except JobConflict as exc:
        await session.rollback()
        existing = await job_runtime.get_active(session, workspace_id)
        raise JobConflict(int(existing.id) if existing is not None else exc.existing_id) from exc
    # The dispatch commits with the row: no crash can leave a ``pending`` job that nothing will run (and that
    # ``OneActive`` would then hold against the workspace). A replayed delivery is skipped by ``run_job``.
    await enqueue_outbox_event(
        session,
        AnalyticsJobRequested(
            job_id=int(job.id), event_id=f"analytics_job:{job.id}", source_service="analytics-service"
        ),
        exchange="",
        routing_key=ANALYTICS_JOB_QUEUE.name,
    )
    await session.commit()
    return job


async def update_progress(
    session: AsyncSession,
    job_id: int,
    *,
    stage: str,
    state: str,
    detail: dict[str, typing.Any] | None = None,
) -> models.AnalyticsJob | None:
    job = await job_runtime.get(session, job_id)
    if job is None:
        return None
    progress = dict(job.progress or {})
    progress[stage] = {"state": state, "detail": detail or {}}
    await _repo.update_fields(session, job, {"progress": progress})
    # Staged before the commit that carries it: this IS the write the tick
    # reports, so the runner never re-reads the row to announce it.
    await emit_job_event(
        session,
        job_id=job_id,
        workspace_id=job.workspace_id,
        tournament_id=int(job.tournament_id),
        kind=job.kind,
        status=job.status,
        progress=progress,
        actor_user_id=job.requested_by_user_id,
    )
    await session.commit()
    return job
