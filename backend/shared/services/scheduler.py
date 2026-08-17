"""Shared ``AsyncIOScheduler`` lifecycle for periodic worker ticks.

Every worker running one leader-locked periodic tick (OverFast rank
collection, subscription collection, match-log stall recovery, Twitch poll)
reimplemented the same module-level singleton by hand: guard against a
double start, build an ``AsyncIOScheduler`` with a single non-overlapping
interval job, and tear it down on shutdown. This wraps that shape once so
each service keeps only its tick logic.
"""

from __future__ import annotations

from collections.abc import Callable, Sequence
from typing import Any

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from loguru import logger as _default_logger


class IntervalScheduler:
    """Module-scoped singleton wrapping one non-overlapping interval job."""

    def __init__(self, *, job_id: str, label: str, logger: Any = _default_logger) -> None:
        self._job_id = job_id
        self._label = label
        self._logger = logger
        self._scheduler: AsyncIOScheduler | None = None

    @property
    def running(self) -> bool:
        return self._scheduler is not None

    def start(
        self,
        func: Callable[..., Any],
        *,
        seconds: int,
        args: Sequence[Any] = (),
        kwargs: dict[str, Any] | None = None,
    ) -> None:
        """Start the interval job unless already running. No-op otherwise."""
        if self._scheduler is not None:
            return
        self._scheduler = AsyncIOScheduler(timezone="UTC")
        self._scheduler.add_job(
            func,
            "interval",
            seconds=seconds,
            id=self._job_id,
            max_instances=1,
            coalesce=True,
            args=list(args),
            kwargs=kwargs or {},
        )
        self._scheduler.start()
        self._logger.info("{} scheduler started (tick={}s)", self._label, seconds)

    def shutdown(self) -> None:
        """Stop the interval job. No-op if not running."""
        if self._scheduler is None:
            return
        self._scheduler.shutdown(wait=False)
        self._scheduler = None
        self._logger.info("{} scheduler stopped", self._label)
