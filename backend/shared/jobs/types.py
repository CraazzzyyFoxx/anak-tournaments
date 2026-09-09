"""Job lifecycle vocabulary.

Storage backends keep their native id type (int vs uuid) and their created
status word (``pending`` vs ``queued``). The runtime only distinguishes
created / active / terminal.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


class Status:
    PENDING = "pending"
    QUEUED = "queued"
    RUNNING = "running"
    SUCCEEDED = "succeeded"
    FAILED = "failed"

    CREATED = frozenset({PENDING, QUEUED})
    ACTIVE = frozenset({PENDING, QUEUED, RUNNING})
    TERMINAL = frozenset({SUCCEEDED, FAILED})


@dataclass(frozen=True)
class Retry:
    """How ``mark_failed`` treats a non-terminal job.

    ``max_attempts=1`` (default) always terminals — analytics/balancer.
    Tournament uses ``max_attempts=3`` and treats ``superseded`` as terminal.
    """

    max_attempts: int = 1
    retry_status: str = Status.PENDING
    extra_terminal: frozenset[str] = field(default_factory=frozenset)

    def should_retry(self, attempts: int) -> bool:
        return self.max_attempts > 1 and attempts < self.max_attempts


@dataclass
class JobSpec:
    kind: str
    workspace_id: int | None = None
    extra: dict[str, Any] = field(default_factory=dict)


class JobConflict(RuntimeError):
    """A concurrency policy rejected the create, or the store unique-key raced."""

    def __init__(self, existing_id: Any = None) -> None:
        self.existing_id = existing_id
        super().__init__(f"an active job already exists (id={existing_id})")
