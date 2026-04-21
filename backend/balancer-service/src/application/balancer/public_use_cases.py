from __future__ import annotations

import asyncio
import json
from collections.abc import AsyncIterator
from typing import Any

from fastapi import HTTPException, Request, status

from src.domain.balancer.public_contract import normalize_balance_job_result_payload
from src.schemas.balancer import BalanceJobResult, CreateJobResponse, JobStatusResponse

TERMINAL_STATUSES = {"succeeded", "failed"}


class GetBalancerConfig:
    def __init__(self, *, config_provider) -> None:
        self._config_provider = config_provider

    def execute(self) -> dict:
        return self._config_provider.get_payload()


class CreateBalanceJob:
    def __init__(
        self,
        *,
        access_policy,
        payload_parser,
        job_repository,
        publisher,
    ) -> None:
        self._access_policy = access_policy
        self._payload_parser = payload_parser
        self._job_repository = job_repository
        self._publisher = publisher

    @staticmethod
    def _build_job_urls(job_id: str) -> dict[str, str]:
        return {
            "status_url": f"/api/balancer/jobs/{job_id}",
            "result_url": f"/api/balancer/jobs/{job_id}/result",
            "stream_url": f"/api/balancer/jobs/{job_id}/stream",
        }

    async def execute(
        self,
        *,
        uploaded_file,
        raw_config: str | None,
        workspace_id: int,
        user,
    ) -> CreateJobResponse:
        self._access_policy.ensure_workspace_access(user, workspace_id)

        player_data = await self._payload_parser.parse_player_data(uploaded_file)
        config_overrides = self._payload_parser.parse_config_overrides(raw_config)
        job_id = await self._job_repository.create_job(
            player_data,
            config_overrides,
            workspace_id=workspace_id,
            created_by=user.id,
        )

        try:
            await self._publisher.publish_job_requested(job_id)
        except Exception as exc:
            if hasattr(self._job_repository, "mark_failed"):
                await self._job_repository.mark_failed(job_id, f"Failed to enqueue balancer job: {exc}")
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Failed to enqueue balancer job",
            ) from exc

        return CreateJobResponse(job_id=job_id, status="queued", **self._build_job_urls(job_id))


class GetBalanceJobStatus:
    def __init__(self, *, job_repository, access_policy) -> None:
        self._job_repository = job_repository
        self._access_policy = access_policy

    async def execute(self, *, job_id: str, user) -> JobStatusResponse:
        meta = await self._job_repository.get_job_meta(job_id)
        if meta is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Balancer job not found")
        self._access_policy.ensure_workspace_access(user, meta.get("workspace_id"))
        return JobStatusResponse.model_validate(meta)


class GetBalanceJobResult:
    def __init__(self, *, job_repository, access_policy) -> None:
        self._job_repository = job_repository
        self._access_policy = access_policy

    async def execute(self, *, job_id: str, user) -> BalanceJobResult:
        meta = await self._job_repository.get_job_meta(job_id)
        if meta is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Balancer job not found")
        self._access_policy.ensure_workspace_access(user, meta.get("workspace_id"))

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

        result = await self._job_repository.get_job_result(job_id)
        if result is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Balancer job result not found")
        return BalanceJobResult.model_validate(result)


class StreamBalanceJobEvents:
    def __init__(self, *, job_repository, access_policy) -> None:
        self._job_repository = job_repository
        self._access_policy = access_policy

    async def execute(
        self,
        *,
        request: Request,
        job_id: str,
        after_event_id: int,
        last_event_id: str | None,
        user,
    ) -> AsyncIterator[str]:
        meta = await self._job_repository.get_job_meta(job_id)
        if meta is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Balancer job not found")
        self._access_policy.ensure_workspace_access(user, meta.get("workspace_id"))

        cursor = after_event_id
        if last_event_id and last_event_id.isdigit():
            cursor = max(cursor, int(last_event_id))

        async def event_generator() -> AsyncIterator[str]:
            next_cursor = cursor
            while True:
                if await request.is_disconnected():
                    break

                events = await self._job_repository.get_events_since(job_id, next_cursor)
                for event in events:
                    next_cursor = max(next_cursor, int(event["event_id"]))
                    yield f"id: {event['event_id']}\ndata: {json.dumps(event, ensure_ascii=False)}\n\n"

                current_meta = await self._job_repository.get_job_meta(job_id)
                if current_meta is None:
                    break
                if current_meta.get("status") in TERMINAL_STATUSES and not events:
                    break

                yield ": heartbeat\n\n"
                await asyncio.sleep(1)

        return event_generator()


class ExecuteBalanceJob:
    def __init__(self, *, job_repository, solver_factory) -> None:
        self._job_repository = job_repository
        self._solver_factory = solver_factory

    @staticmethod
    def _build_progress_callback(event_queue: asyncio.Queue, loop: asyncio.AbstractEventLoop):
        def progress_callback(progress_payload: dict[str, Any]) -> None:
            loop.call_soon_threadsafe(event_queue.put_nowait, progress_payload)

        return progress_callback

    async def execute(self, job_id: str) -> None:
        payload = await self._job_repository.get_job_payload(job_id)
        if payload is None:
            return

        current_meta = await self._job_repository.get_job_meta(job_id)
        if current_meta and current_meta.get("status") in TERMINAL_STATUSES:
            return

        await self._job_repository.mark_running(job_id)

        event_queue: asyncio.Queue[dict[str, Any] | None] = asyncio.Queue()
        loop = asyncio.get_running_loop()
        progress_callback = self._build_progress_callback(event_queue, loop)

        async def consume_progress_events() -> None:
            while True:
                update = await event_queue.get()
                if update is None:
                    break

                status_value = str(update.get("status", "running"))
                status_name = status_value if status_value in TERMINAL_STATUSES | {"queued", "running"} else "running"
                await self._job_repository.append_event(
                    job_id,
                    status=status_name,
                    stage=str(update.get("stage", "running")),
                    message=str(update.get("message", "")),
                    level=str(update.get("level", "info")),
                    progress=update.get("progress"),
                    update_meta=True,
                )

        consume_task = asyncio.create_task(consume_progress_events())

        try:
            input_data = payload.get("player_data")
            config_overrides = payload.get("config_overrides") or {}
            if not isinstance(input_data, dict):
                raise ValueError("Job payload does not contain valid player data")

            algorithm = str(config_overrides.get("algorithm", "moo"))
            await self._job_repository.append_event(
                job_id,
                status="running",
                stage="solving",
                message=f"Running {algorithm} solver...",
                level="info",
                progress=None,
                update_meta=True,
            )

            solver = self._solver_factory.get_solver(algorithm)
            result = await solver.solve(input_data, config_overrides, progress_callback)
            result = normalize_balance_job_result_payload(result)

            await asyncio.sleep(0)
            await event_queue.put(None)
            await consume_task
            await self._job_repository.mark_succeeded(job_id, result)
        except Exception as exc:
            await asyncio.sleep(0)
            await event_queue.put(None)
            await consume_task
            await self._job_repository.mark_failed(job_id, f"Balancer job failed: {exc}")
            raise
