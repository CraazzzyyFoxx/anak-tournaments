"""Concurrency policies. Injected into JobService; never hardcoded there."""

from __future__ import annotations

from typing import Any, Protocol

from shared.jobs.types import JobConflict, JobSpec


class ConcurrencyPolicy[T](Protocol):
    async def acquire(self, ctx: Any, spec: JobSpec, store: Any) -> None: ...


class Unlimited:
    """No cap. Balancer uses this — slot limits live in ApiKeyUsageLimiter."""

    async def acquire(self, ctx: Any, spec: JobSpec, store: Any) -> None:
        del ctx, spec, store


class OneActive:
    """At most one created/running job per workspace_id (analytics)."""

    async def acquire(self, ctx: Any, spec: JobSpec, store: Any) -> None:
        existing = await store.get_active(ctx, spec.workspace_id)
        if existing is not None:
            raise JobConflict(store.id_of(existing))


class SlotLimited:
    """Call ``reserve(spec)`` before create. ``release`` is the caller's job
    on failure — the limiter already knows the principal."""

    def __init__(self, reserve) -> None:
        self._reserve = reserve

    async def acquire(self, ctx: Any, spec: JobSpec, store: Any) -> None:
        del ctx, store
        await self._reserve(spec)
