"""Redis JobStore adapter over a BalancerJobStore-shaped object.

The inner store keeps payload, event log, TTL, and slot-release. This adapter
only maps the shared lifecycle onto ``create_job`` / ``get_job_meta`` / ``mark_*``.
"""

from __future__ import annotations

from collections.abc import Sequence
from typing import Any

from shared.jobs.types import JobSpec, Status


class RedisMetaStore:
    def __init__(self, inner: Any) -> None:
        self.inner = inner

    def id_of(self, job: dict[str, Any]) -> str:
        return str(job["job_id"])

    def status_of(self, job: dict[str, Any]) -> str:
        return str(job["status"])

    async def create(self, ctx: Any, spec: JobSpec) -> dict[str, Any]:
        del ctx
        extra = spec.extra
        job_id = await self.inner.create_job(
            extra["player_data"],
            extra.get("config_overrides"),
            job_id=extra.get("job_id"),
            workspace_id=spec.workspace_id,
            tournament_id=extra.get("tournament_id"),
            created_by=extra.get("created_by"),
            credential_type=extra.get("credential_type", "access_token"),
            api_key_id=extra.get("api_key_id"),
            role_mask=extra.get("role_mask"),
        )
        getter = getattr(self.inner, "get_job_meta", None)
        if getter is None:
            return {"job_id": job_id, "status": Status.QUEUED}
        meta = await getter(job_id)
        if meta is None:
            return {"job_id": job_id, "status": Status.QUEUED}
        return meta

    async def get(self, ctx: Any, job_id: Any) -> dict[str, Any] | None:
        del ctx
        meta = await self.inner.get_job_meta(str(job_id))
        if meta is None:
            return None
        if "job_id" not in meta:
            return {**meta, "job_id": str(job_id)}
        return meta

    async def get_active(self, ctx: Any, workspace_id: int | None) -> dict[str, Any] | None:
        del ctx, workspace_id
        return None

    async def list(
        self,
        ctx: Any,
        *,
        workspace_id: int | None,
        limit: int = 20,
        statuses: Sequence[str] | None = None,
    ) -> Sequence[dict[str, Any]]:
        del ctx, workspace_id, limit, statuses
        return []


    async def set_fields(self, ctx: Any, job: dict[str, Any], fields: dict[str, Any]) -> dict[str, Any]:
        del ctx
        job_id = self.id_of(job)
        status = fields.get("status")
        if status == Status.RUNNING:
            return await self.inner.mark_running(job_id, meta=job)
        if status == Status.SUCCEEDED:
            return await self.inner.mark_succeeded(job_id, fields.get("result") or {}, meta=job)
        if status == Status.FAILED:
            return await self.inner.mark_failed(job_id, str(fields.get("error") or ""), meta=job)
        job.update(fields)
        return job
