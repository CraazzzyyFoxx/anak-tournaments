from __future__ import annotations

import asyncio
import json
import time
from collections.abc import AsyncIterator
from typing import Any

from fastapi import HTTPException, Request, status
from loguru import logger

from src.core.metrics import (
    BALANCER_JOB_QUEUE_WAIT_SECONDS,
    BALANCER_JOB_TOTAL_SECONDS,
    BALANCER_SOLVER_SECONDS,
)
from src.domain.balancer.public_contract import normalize_balance_job_result_payload
from src.schemas.balancer import BalanceJobResult, CreateJobResponse, JobStatusResponse

TERMINAL_STATUSES = {"succeeded", "failed"}
ACTIVE_JOB_STATUSES = TERMINAL_STATUSES | {"queued", "running"}
PROGRESS_EVENT_INTERVAL_SECONDS = 0.5
PROGRESS_PERCENT_STEP = 5.0


def _extract_progress_percent(progress: Any) -> float | None:
    if not isinstance(progress, dict):
        return None
    percent = progress.get("percent")
    if percent is not None:
        try:
            return float(percent)
        except (TypeError, ValueError):
            return None
    current = progress.get("current")
    total = progress.get("total")
    if current is None or total in (None, 0):
        return None
    try:
        return (float(current) / float(total)) * 100.0
    except (TypeError, ValueError, ZeroDivisionError):
        return None


def _count_variant_players(variant: dict[str, Any]) -> int:
    team_players = sum(
        len(role_players)
        for team in variant.get("teams", [])
        if isinstance(team, dict)
        for role_players in team.get("roster", {}).values()
        if isinstance(role_players, list)
    )
    benched_players = variant.get("benched_players", [])
    benched_count = len(benched_players) if isinstance(benched_players, list) else 0
    return team_players + benched_count


class ProgressEventThrottler:
    def __init__(
        self,
        *,
        job_repository,
        job_id: str,
        meta: dict[str, Any],
        clock=None,
    ) -> None:
        self._job_repository = job_repository
        self._job_id = job_id
        self._meta = meta
        self._clock = clock or time.monotonic
        self._last_emitted_stage: str | None = None
        self._last_emitted_percent: float | None = None
        self._last_emitted_at: float | None = None
        self._pending_update: dict[str, Any] | None = None
        self.emitted_count = 0

    async def handle(self, update: dict[str, Any]) -> None:
        now = self._clock()
        if self._should_emit(update, now):
            await self._emit(update, now)
            return
        self._pending_update = update

    async def flush_pending(self) -> None:
        if self._pending_update is None:
            return
        pending_update = self._pending_update
        self._pending_update = None
        await self._emit(pending_update, self._clock())

    def _should_emit(self, update: dict[str, Any], now: float) -> bool:
        status_value = str(update.get("status", "running"))
        stage_value = str(update.get("stage", "running"))
        percent = _extract_progress_percent(update.get("progress"))

        if status_value in TERMINAL_STATUSES:
            return True
        if self._last_emitted_at is None:
            return True
        if stage_value != self._last_emitted_stage:
            return True
        if (
            percent is not None
            and self._last_emitted_percent is not None
            and percent - self._last_emitted_percent >= PROGRESS_PERCENT_STEP
        ):
            return True
        return now - self._last_emitted_at >= PROGRESS_EVENT_INTERVAL_SECONDS

    async def _emit(self, update: dict[str, Any], now: float) -> None:
        status_value = str(update.get("status", "running"))
        status_name = status_value if status_value in ACTIVE_JOB_STATUSES else "running"
        stage_value = str(update.get("stage", "running"))
        progress = update.get("progress")

        await self._job_repository.append_event(
            self._job_id,
            status=status_name,
            stage=stage_value,
            message=str(update.get("message", "")),
            level=str(update.get("level", "info")),
            progress=progress if isinstance(progress, dict) else None,
            update_meta=True,
            meta=self._meta,
        )

        self.emitted_count += 1
        self._last_emitted_at = now
        self._last_emitted_stage = stage_value
        self._last_emitted_percent = _extract_progress_percent(progress)


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
    def __init__(self, *, job_repository, solver_factory, progress_clock=None) -> None:
        self._job_repository = job_repository
        self._solver_factory = solver_factory
        self._progress_clock = progress_clock

    @staticmethod
    def _build_progress_callback(event_queue: asyncio.Queue, loop: asyncio.AbstractEventLoop):
        def progress_callback(progress_payload: dict[str, Any]) -> None:
            loop.call_soon_threadsafe(event_queue.put_nowait, progress_payload)

        return progress_callback

    async def execute(self, job_id: str) -> None:
        total_started_at = time.perf_counter()
        payload = await self._job_repository.get_job_payload(job_id)
        if payload is None:
            return

        current_meta = await self._job_repository.get_job_meta(job_id)
        if current_meta and current_meta.get("status") in TERMINAL_STATUSES:
            return

        event_queue: asyncio.Queue[dict[str, Any] | None] = asyncio.Queue()
        loop = asyncio.get_running_loop()
        progress_callback = self._build_progress_callback(event_queue, loop)
        progress_throttler: ProgressEventThrottler | None = None
        consume_task: asyncio.Task[None] | None = None
        algorithm = "moo"
        player_count = 0
        team_count = 0
        queue_wait_seconds = 0.0
        solver_seconds = 0.0

        async def stop_progress_consumer(*, suppress_exceptions: bool) -> None:
            if consume_task is None:
                return
            if not consume_task.done():
                await event_queue.put(None)
            try:
                await consume_task
            except Exception:
                if not suppress_exceptions:
                    raise

        try:
            input_data = payload.get("player_data")
            config_overrides = payload.get("config_overrides") or {}
            if not isinstance(input_data, dict):
                raise ValueError("Job payload does not contain valid player data")
            if not isinstance(config_overrides, dict):
                raise ValueError("Job payload does not contain valid config overrides")

            algorithm = str(config_overrides.get("algorithm", "moo"))
            created_at = current_meta.get("created_at") if isinstance(current_meta, dict) else None
            if isinstance(created_at, (int, float)):
                queue_wait_seconds = max(0.0, time.time() - float(created_at))
            BALANCER_JOB_QUEUE_WAIT_SECONDS.labels(algorithm=algorithm).observe(queue_wait_seconds)

            players_payload = input_data.get("players", {})
            if isinstance(players_payload, dict):
                player_count = len(players_payload)

            current_meta = await self._job_repository.mark_running(job_id, meta=current_meta)
            progress_throttler = ProgressEventThrottler(
                job_repository=self._job_repository,
                job_id=job_id,
                meta=current_meta,
                clock=self._progress_clock,
            )

            async def consume_progress_events() -> None:
                while True:
                    update = await event_queue.get()
                    if update is None:
                        break
                    await progress_throttler.handle(update)

            consume_task = asyncio.create_task(consume_progress_events())

            await self._job_repository.append_event(
                job_id,
                status="running",
                stage="solving",
                message=f"Running {algorithm} solver...",
                level="info",
                progress=None,
                update_meta=True,
                meta=current_meta,
            )

            solver = self._solver_factory.get_solver(algorithm)
            solver_started_at = time.perf_counter()
            result = await solver.solve(input_data, config_overrides, progress_callback)
            solver_seconds = time.perf_counter() - solver_started_at
            BALANCER_SOLVER_SECONDS.labels(algorithm=algorithm).observe(solver_seconds)
            result = normalize_balance_job_result_payload(result)

            await asyncio.sleep(0)
            await stop_progress_consumer(suppress_exceptions=False)
            await progress_throttler.flush_pending()

            variants = result.get("variants", [])
            if variants:
                first_variant = variants[0]
                statistics = first_variant.get("statistics", {})
                if isinstance(statistics, dict):
                    team_count = int(statistics.get("total_teams") or 0)
                if team_count <= 0:
                    teams = first_variant.get("teams", [])
                    if isinstance(teams, list):
                        team_count = len(teams)
                resolved_player_count = _count_variant_players(first_variant)
                if resolved_player_count > 0:
                    player_count = resolved_player_count

            current_meta = await self._job_repository.mark_succeeded(job_id, result, meta=current_meta)
            total_seconds = time.perf_counter() - total_started_at
            BALANCER_JOB_TOTAL_SECONDS.labels(algorithm=algorithm, status="succeeded").observe(total_seconds)
            logger.bind(
                job_id=job_id,
                algorithm=algorithm,
                player_count=player_count,
                team_count=team_count,
                progress_events_emitted=progress_throttler.emitted_count,
                queue_wait_ms=round(queue_wait_seconds * 1000, 2),
                solver_ms=round(solver_seconds * 1000, 2),
                total_ms=round(total_seconds * 1000, 2),
                events_count=current_meta.get("events_count") if isinstance(current_meta, dict) else None,
            ).info("Balancer job execution completed")
        except Exception as exc:
            if progress_throttler is not None:
                await asyncio.sleep(0)
                await stop_progress_consumer(suppress_exceptions=True)
                await progress_throttler.flush_pending()

            current_meta = await self._job_repository.mark_failed(
                job_id,
                f"Balancer job failed: {exc}",
                meta=current_meta,
            )
            total_seconds = time.perf_counter() - total_started_at
            BALANCER_JOB_TOTAL_SECONDS.labels(algorithm=algorithm, status="failed").observe(total_seconds)
            logger.bind(
                job_id=job_id,
                algorithm=algorithm,
                player_count=player_count,
                team_count=team_count,
                progress_events_emitted=progress_throttler.emitted_count if progress_throttler is not None else 0,
                queue_wait_ms=round(queue_wait_seconds * 1000, 2),
                solver_ms=round(solver_seconds * 1000, 2),
                total_ms=round(total_seconds * 1000, 2),
                events_count=current_meta.get("events_count") if isinstance(current_meta, dict) else None,
            ).error("Balancer job execution failed")
            raise
