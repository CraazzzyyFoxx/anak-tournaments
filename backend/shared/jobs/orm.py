"""ORM JobStore: one row per job, session is the context."""

from __future__ import annotations

from collections.abc import Sequence
from typing import Any

from sqlalchemy.exc import IntegrityError

from shared.jobs.types import JobConflict, JobSpec, Status


class OrmJobStore:
    def __init__(
        self,
        *,
        repo: Any,
        model: type,
        created_status: str = Status.PENDING,
        active_statuses: Sequence[str] = tuple(Status.ACTIVE),
    ) -> None:
        self.repo = repo
        self.model = model
        self.created_status = created_status
        self.active_statuses = tuple(active_statuses)

    def id_of(self, job: Any) -> Any:
        return job.id

    def status_of(self, job: Any) -> str:
        return str(job.status)

    async def create(self, session: Any, spec: JobSpec) -> Any:
        row = self.model(
            kind=spec.kind,
            workspace_id=spec.workspace_id,
            status=self.created_status,
            **spec.extra,
        )
        try:
            return await self.repo.create(session, row)
        except IntegrityError:
            existing = await self.get_active(session, spec.workspace_id)
            raise JobConflict(self.id_of(existing) if existing is not None else None)

    async def get(self, session: Any, job_id: Any) -> Any | None:
        return await self.repo.get(session, int(job_id))

    async def get_active(self, session: Any, workspace_id: int | None) -> Any | None:
        return await self.repo.get_active(session, workspace_id, self.active_statuses)

    async def list(
        self,
        session: Any,
        *,
        workspace_id: int | None,
        limit: int = 20,
        statuses: Sequence[str] | None = None,
    ) -> Sequence[Any]:
        return await self.repo.list_by_workspace(session, workspace_id, limit=limit, statuses=statuses)

    async def set_fields(self, session: Any, job: Any, fields: dict[str, Any]) -> Any:
        return await self.repo.update_fields(session, job, fields)
