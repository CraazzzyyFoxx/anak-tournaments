"""Storage port. One implementation per backend (ORM row, Redis hash, …)."""

from __future__ import annotations

from collections.abc import Sequence
from typing import Any, Protocol


class JobStore[T](Protocol):
    def id_of(self, job: T) -> Any: ...
    def status_of(self, job: T) -> str: ...

    async def create(self, ctx: Any, spec: Any) -> T: ...
    async def get(self, ctx: Any, job_id: Any) -> T | None: ...
    async def get_active(self, ctx: Any, workspace_id: int | None) -> T | None: ...
    async def list(
        self,
        ctx: Any,
        *,
        workspace_id: int | None,
        limit: int = 20,
        statuses: Sequence[str] | None = None,
    ) -> Sequence[T]: ...
    async def set_fields(self, ctx: Any, job: T, fields: dict[str, Any]) -> T: ...
