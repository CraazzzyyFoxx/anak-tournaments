"""Generic job lifecycle. Store + concurrency + retry are the variation."""

from __future__ import annotations

from collections.abc import Sequence
from datetime import UTC, datetime
from typing import Any

from shared.jobs.policy import ConcurrencyPolicy
from shared.jobs.store import JobStore
from shared.jobs.types import JobSpec, Retry, Status


class JobService[T]:
    def __init__(
        self,
        *,
        store: JobStore[T],
        concurrency: ConcurrencyPolicy[T],
        retry: Retry | None = None,
    ) -> None:
        self.store = store
        self.concurrency = concurrency
        self.retry = retry or Retry()


    async def create(self, ctx: Any, spec: JobSpec) -> T:
        await self.concurrency.acquire(ctx, spec, self.store)
        return await self.store.create(ctx, spec)

    async def get(self, ctx: Any, job_id: Any) -> T | None:
        return await self.store.get(ctx, job_id)

    async def get_active(self, ctx: Any, workspace_id: int | None) -> T | None:
        return await self.store.get_active(ctx, workspace_id)

    async def list(
        self,
        ctx: Any,
        *,
        workspace_id: int | None,
        limit: int = 20,
        statuses: Sequence[str] | None = None,
    ) -> Sequence[T]:
        return await self.store.list(ctx, workspace_id=workspace_id, limit=limit, statuses=statuses)

    async def mark_running(self, ctx: Any, job_id: Any) -> T | None:
        job = await self.store.get(ctx, job_id)
        if job is None or self.store.status_of(job) not in Status.CREATED:
            return job
        return await self.store.set_fields(
            ctx,
            job,
            {"status": Status.RUNNING, "started_at": datetime.now(UTC)},
        )

    async def mark_succeeded(self, ctx: Any, job_id: Any, **fields: Any) -> T | None:
        job = await self.store.get(ctx, job_id)
        if job is None:
            return None
        return await self.store.set_fields(
            ctx,
            job,
            {"status": Status.SUCCEEDED, "finished_at": datetime.now(UTC), **fields},
        )

    def _attempts(self, job: T) -> int:
        fn = getattr(self.store, "attempts_of", None)
        if fn is not None:
            return int(fn(job))
        value = getattr(job, "attempts", None)
        return 1 if value is None else int(value)

    async def mark_failed(self, ctx: Any, job_id: Any, *, error: str) -> T | None:
        job = await self.store.get(ctx, job_id)
        if job is None:
            return None
        status = self.store.status_of(job)
        if status in Status.TERMINAL or status in self.retry.extra_terminal:
            return job
        if self.retry.should_retry(self._attempts(job)):
            return await self.store.set_fields(
                ctx,
                job,
                {"status": self.retry.retry_status, "error": error, "finished_at": None},
            )
        return await self.store.set_fields(
            ctx,
            job,
            {"status": Status.FAILED, "error": error, "finished_at": datetime.now(UTC)},
        )
