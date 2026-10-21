"""Run the runtime hooks of the disciplines a worker selected (``DisciplineSpec.register_jobs``/``start_jobs``/``stop_jobs``).

A discipline without hooks contributes nothing, so selecting only it starts no job.
"""

from __future__ import annotations

from collections.abc import Awaitable, Iterable
from typing import Any

from shared.disciplines.spec import DisciplineSpec

__all__ = ("configure_runtime", "register_jobs", "start_jobs", "stop_jobs")


def configure_runtime(specs: Iterable[DisciplineSpec], broker: Any, *, session_factory: Any, redis: Any) -> None:
    """Wire the collection handlers of ``specs`` without registering a consumer or starting a schedule."""
    for spec in specs:
        if spec.configure_runtime is not None:
            spec.configure_runtime(broker, session_factory=session_factory, redis=redis)


def register_jobs(
    specs: Iterable[DisciplineSpec], broker: Any, *, session_factory: Any, redis: Any, logger: Any
) -> None:
    for spec in specs:
        if spec.register_jobs is not None:
            spec.register_jobs(broker, session_factory=session_factory, redis=redis, logger=logger)


async def start_jobs(specs: Iterable[DisciplineSpec], *, session_factory: Any, redis: Any, logger: Any) -> None:
    for spec in specs:
        if spec.start_jobs is not None:
            await spec.start_jobs(session_factory=session_factory, redis=redis, logger=logger)


def stop_jobs(specs: Iterable[DisciplineSpec]) -> list[Awaitable[None]]:
    """Stops every selected module's schedules now; await the result once consumers drained to release its clients."""
    return [spec.stop_jobs() for spec in specs if spec.stop_jobs is not None]
