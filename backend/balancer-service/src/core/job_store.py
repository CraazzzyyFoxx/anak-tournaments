from __future__ import annotations

import json
import time
import uuid
from typing import Any, Literal

import redis.asyncio as redis
from src.core.config import config

JobStatus = Literal["queued", "running", "succeeded", "failed"]


class BalancerJobStore:
    """Redis-backed storage for balancer jobs, events, and results."""

    def __init__(self, redis_url: str, ttl_seconds: int) -> None:
        self._redis = redis.from_url(redis_url, decode_responses=True)
        self._ttl_seconds = ttl_seconds

    @staticmethod
    def _meta_key(job_id: str) -> str:
        return f"balancer:job:{job_id}:meta"

    @staticmethod
    def _payload_key(job_id: str) -> str:
        return f"balancer:job:{job_id}:payload"

    @staticmethod
    def _result_key(job_id: str) -> str:
        return f"balancer:job:{job_id}:result"

    @staticmethod
    def _events_key(job_id: str) -> str:
        return f"balancer:job:{job_id}:events"

    @staticmethod
    def _event_sequence_key(job_id: str) -> str:
        return f"balancer:job:{job_id}:event_seq"

    async def _refresh_ttl(self, job_id: str) -> None:
        pipe = self._redis.pipeline()
        for key in (
            self._meta_key(job_id),
            self._payload_key(job_id),
            self._result_key(job_id),
            self._events_key(job_id),
            self._event_sequence_key(job_id),
        ):
            pipe.expire(key, self._ttl_seconds)
        await pipe.execute()

    async def _save_meta(self, job_id: str, meta: dict[str, Any]) -> None:
        await self._redis.set(self._meta_key(job_id), json.dumps(meta), ex=self._ttl_seconds)

    async def create_job(self, input_data: dict[str, Any], config_overrides: dict[str, Any] | None) -> str:
        job_id = uuid.uuid4().hex
        now = time.time()

        meta = {
            "job_id": job_id,
            "status": "queued",
            "stage": "queued",
            "created_at": now,
            "started_at": None,
            "finished_at": None,
            "progress": None,
            "error": None,
        }
        payload = {
            "data": input_data,
            "config": config_overrides,
        }

        pipe = self._redis.pipeline()
        pipe.set(self._meta_key(job_id), json.dumps(meta), ex=self._ttl_seconds)
        pipe.set(self._payload_key(job_id), json.dumps(payload), ex=self._ttl_seconds)
        pipe.set(self._event_sequence_key(job_id), 0, ex=self._ttl_seconds)
        await pipe.execute()

        await self.append_event(
            job_id,
            status="queued",
            stage="queued",
            level="info",
            message="Balancer job accepted and queued",
            update_meta=True,
        )
        return job_id

    async def get_job_meta(self, job_id: str) -> dict[str, Any] | None:
        raw = await self._redis.get(self._meta_key(job_id))
        if raw is None:
            return None

        meta = json.loads(raw)
        meta["events_count"] = await self._redis.llen(self._events_key(job_id))
        return meta

    async def get_job_payload(self, job_id: str) -> dict[str, Any] | None:
        raw = await self._redis.get(self._payload_key(job_id))
        if raw is None:
            return None
        return json.loads(raw)

    async def get_job_result(self, job_id: str) -> dict[str, Any] | None:
        raw = await self._redis.get(self._result_key(job_id))
        if raw is None:
            return None
        return json.loads(raw)

    async def append_event(
        self,
        job_id: str,
        *,
        status: JobStatus,
        stage: str,
        message: str,
        level: str = "info",
        progress: dict[str, Any] | None = None,
        update_meta: bool = False,
    ) -> dict[str, Any]:
        event_id = await self._redis.incr(self._event_sequence_key(job_id))
        event = {
            "event_id": event_id,
            "timestamp": time.time(),
            "level": level,
            "status": status,
            "stage": stage,
            "message": message,
            "progress": progress,
        }

        await self._redis.rpush(self._events_key(job_id), json.dumps(event))

        if update_meta:
            meta = await self.get_job_meta(job_id)
            if meta is not None:
                meta["status"] = status
                meta["stage"] = stage
                if progress is not None:
                    meta["progress"] = progress
                if status == "running" and meta.get("started_at") is None:
                    meta["started_at"] = time.time()
                if status in {"failed", "succeeded"}:
                    meta["finished_at"] = time.time()
                await self._save_meta(job_id, meta)

        await self._refresh_ttl(job_id)
        return event

    async def mark_running(self, job_id: str) -> None:
        meta = await self.get_job_meta(job_id)
        if meta is None:
            raise KeyError(job_id)

        meta["status"] = "running"
        meta["stage"] = "running"
        meta["started_at"] = time.time()
        meta["error"] = None
        await self._save_meta(job_id, meta)

        await self.append_event(
            job_id,
            status="running",
            stage="running",
            level="info",
            message="Balancer job started",
            update_meta=False,
        )

    async def update_runtime_state(
        self,
        job_id: str,
        *,
        stage: str,
        status: JobStatus = "running",
        progress: dict[str, Any] | None = None,
    ) -> None:
        meta = await self.get_job_meta(job_id)
        if meta is None:
            raise KeyError(job_id)

        meta["status"] = status
        meta["stage"] = stage
        if progress is not None:
            meta["progress"] = progress
        await self._save_meta(job_id, meta)

    async def mark_succeeded(self, job_id: str, result: dict[str, Any]) -> None:
        meta = await self.get_job_meta(job_id)
        if meta is None:
            raise KeyError(job_id)

        meta["status"] = "succeeded"
        meta["stage"] = "completed"
        meta["finished_at"] = time.time()
        meta["error"] = None

        pipe = self._redis.pipeline()
        pipe.set(self._meta_key(job_id), json.dumps(meta), ex=self._ttl_seconds)
        pipe.set(self._result_key(job_id), json.dumps(result), ex=self._ttl_seconds)
        await pipe.execute()

        await self.append_event(
            job_id,
            status="succeeded",
            stage="completed",
            level="success",
            message="Balancer job completed successfully",
            update_meta=False,
        )

    async def mark_failed(self, job_id: str, error_message: str) -> None:
        meta = await self.get_job_meta(job_id)
        if meta is None:
            raise KeyError(job_id)

        meta["status"] = "failed"
        meta["stage"] = "failed"
        meta["finished_at"] = time.time()
        meta["error"] = error_message
        await self._save_meta(job_id, meta)

        await self.append_event(
            job_id,
            status="failed",
            stage="failed",
            level="error",
            message=error_message,
            update_meta=False,
        )

    async def get_events_since(self, job_id: str, after_event_id: int = 0) -> list[dict[str, Any]]:
        start_index = max(after_event_id, 0)
        raw_events = await self._redis.lrange(self._events_key(job_id), start_index, -1)
        return [json.loads(item) for item in raw_events]

    async def close(self) -> None:
        await self._redis.aclose()


_job_store: BalancerJobStore | None = None


def get_job_store() -> BalancerJobStore:
    global _job_store
    if _job_store is None:
        _job_store = BalancerJobStore(config.redis_url, config.balancer_job_ttl_seconds)
    return _job_store


async def close_job_store() -> None:
    global _job_store
    if _job_store is None:
        return
    await _job_store.close()
    _job_store = None
