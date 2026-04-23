from __future__ import annotations

from typing import Any

from src.core.job_store import BalancerJobStore, get_job_store


class JobStoreRepository:
    def __init__(self, store: BalancerJobStore | None = None) -> None:
        self._store = store or get_job_store()

    async def create_job(
        self,
        input_data: dict[str, Any],
        config_overrides: dict[str, Any] | None,
        *,
        workspace_id: int | None = None,
        created_by: int | None = None,
    ) -> str:
        return await self._store.create_job(
            input_data,
            config_overrides,
            workspace_id=workspace_id,
            created_by=created_by,
        )

    async def get_job_meta(self, job_id: str) -> dict[str, Any] | None:
        return await self._store.get_job_meta(job_id)

    async def get_job_payload(self, job_id: str) -> dict[str, Any] | None:
        return await self._store.get_job_payload(job_id)

    async def get_job_result(self, job_id: str) -> dict[str, Any] | None:
        return await self._store.get_job_result(job_id)

    async def append_event(
        self,
        job_id: str,
        *,
        status: str,
        stage: str,
        message: str,
        level: str = "info",
        progress: dict[str, Any] | None = None,
        update_meta: bool = False,
        meta: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        return await self._store.append_event(
            job_id,
            status=status,
            stage=stage,
            message=message,
            level=level,
            progress=progress,
            update_meta=update_meta,
            meta=meta,
        )

    async def mark_running(self, job_id: str, meta: dict[str, Any] | None = None) -> dict[str, Any]:
        return await self._store.mark_running(job_id, meta=meta)

    async def mark_succeeded(
        self,
        job_id: str,
        result: dict[str, Any],
        meta: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        return await self._store.mark_succeeded(job_id, result, meta=meta)

    async def mark_failed(self, job_id: str, error_message: str, meta: dict[str, Any] | None = None) -> dict[str, Any]:
        return await self._store.mark_failed(job_id, error_message, meta=meta)

    async def update_runtime_state(
        self,
        job_id: str,
        *,
        stage: str,
        status: str = "running",
        progress: dict[str, Any] | None = None,
        meta: dict[str, Any] | None = None,
    ) -> None:
        await self._store.update_runtime_state(
            job_id,
            stage=stage,
            status=status,
            progress=progress,
            meta=meta,
        )

    async def get_events_since(self, job_id: str, after_event_id: int = 0) -> list[dict[str, Any]]:
        return await self._store.get_events_since(job_id, after_event_id)
