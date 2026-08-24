"""JobService lifecycle + OneActive policy, no real backend."""

from __future__ import annotations

import os
import sys
from pathlib import Path
from unittest import IsolatedAsyncioTestCase

BACKEND_ROOT = Path(__file__).resolve().parents[2]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

os.environ.setdefault("PROJECT_URL", "http://localhost")
os.environ.setdefault("REDIS_URL", "redis://localhost:6379/0")

from shared.jobs import JobConflict, JobService, JobSpec, OneActive, Retry, Status, Unlimited  # noqa: E402


class _Job:
    def __init__(self, job_id: int, spec: JobSpec) -> None:
        self.id = job_id
        self.status = Status.PENDING
        self.kind = spec.kind
        self.workspace_id = spec.workspace_id
        self.error: str | None = None
        self.started_at = None
        self.finished_at = None
        self.attempts = 1



class _FakeStore:
    def __init__(self) -> None:
        self.rows: dict[int, _Job] = {}
        self._next = 1

    def id_of(self, job: _Job) -> int:
        return job.id

    def status_of(self, job: _Job) -> str:
        return job.status

    async def create(self, ctx, spec: JobSpec) -> _Job:
        del ctx
        job = _Job(self._next, spec)
        self._next += 1
        self.rows[job.id] = job
        return job

    async def get(self, ctx, job_id) -> _Job | None:
        del ctx
        return self.rows.get(int(job_id))

    async def get_active(self, ctx, workspace_id: int | None) -> _Job | None:
        del ctx
        for job in self.rows.values():
            if job.workspace_id == workspace_id and job.status in Status.ACTIVE:
                return job
        return None

    async def list(self, ctx, *, workspace_id, limit=20, statuses=None):
        del ctx, limit
        out = [j for j in self.rows.values() if j.workspace_id == workspace_id]
        if statuses is not None:
            out = [j for j in out if j.status in statuses]
        return out

    async def set_fields(self, ctx, job: _Job, fields: dict) -> _Job:
        del ctx
        for key, value in fields.items():
            setattr(job, key, value)
        return job


class JobServiceTests(IsolatedAsyncioTestCase):
    async def test_create_and_mark_running_succeeded(self) -> None:
        runtime = JobService(store=_FakeStore(), concurrency=Unlimited())
        job = await runtime.create(None, JobSpec(kind="compute", workspace_id=1))
        self.assertEqual(Status.PENDING, job.status)
        running = await runtime.mark_running(None, job.id)
        self.assertEqual(Status.RUNNING, running.status)
        done = await runtime.mark_succeeded(None, job.id)
        self.assertEqual(Status.SUCCEEDED, done.status)

    async def test_one_active_rejects_second_create(self) -> None:
        runtime = JobService(store=_FakeStore(), concurrency=OneActive())
        await runtime.create(None, JobSpec(kind="compute", workspace_id=7))
        with self.assertRaises(JobConflict):
            await runtime.create(None, JobSpec(kind="compute", workspace_id=7))

    async def test_one_active_allows_other_workspace(self) -> None:
        runtime = JobService(store=_FakeStore(), concurrency=OneActive())
        await runtime.create(None, JobSpec(kind="compute", workspace_id=1))
        other = await runtime.create(None, JobSpec(kind="compute", workspace_id=2))
        self.assertEqual(2, other.workspace_id)

    async def test_default_retry_terminals_on_first_failure(self) -> None:
        runtime = JobService(store=_FakeStore(), concurrency=Unlimited())
        job = await runtime.create(None, JobSpec(kind="compute", workspace_id=1))
        await runtime.mark_running(None, job.id)
        failed = await runtime.mark_failed(None, job.id, error="boom")
        self.assertEqual(Status.FAILED, failed.status)
        self.assertIsNotNone(failed.finished_at)

    async def test_retry_returns_created_status_until_max_attempts(self) -> None:
        store = _FakeStore()
        runtime = JobService(store=store, concurrency=Unlimited(), retry=Retry(max_attempts=3))
        job = await runtime.create(None, JobSpec(kind="compute", workspace_id=1))
        job.attempts = 1
        job.status = Status.RUNNING
        retried = await runtime.mark_failed(None, job.id, error="temp")
        self.assertEqual(Status.PENDING, retried.status)
        self.assertIsNone(retried.finished_at)
        job.attempts = 3
        job.status = Status.RUNNING
        failed = await runtime.mark_failed(None, job.id, error="perm")
        self.assertEqual(Status.FAILED, failed.status)

    async def test_retry_ignores_already_terminal_job(self) -> None:
        runtime = JobService(
            store=_FakeStore(),
            concurrency=Unlimited(),
            retry=Retry(max_attempts=3, extra_terminal=frozenset({"superseded"})),
        )
        job = await runtime.create(None, JobSpec(kind="compute", workspace_id=1))
        job.status = "superseded"
        ignored = await runtime.mark_failed(None, job.id, error="late")
        self.assertEqual("superseded", ignored.status)

