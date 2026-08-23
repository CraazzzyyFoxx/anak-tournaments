"""Division-grid version/tier/mapping CRUD.

``DivisionGridRepository`` (the grid header itself) already lives in
:mod:`shared.repository.support`; this module owns the versioned content hanging off
it — versions, tiers, cross-version mappings and their rules, plus the marketplace
import-job queue.
"""

from __future__ import annotations

from collections.abc import Sequence
from datetime import datetime
from typing import Any

import sqlalchemy as sa
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm.strategy_options import _AbstractLoad

from shared import models
from shared.repository.base import BaseRepository


class DivisionGridVersionRepository(BaseRepository[models.DivisionGridVersion]):
    def __init__(self) -> None:
        super().__init__(models.DivisionGridVersion)

    async def list_by_grid(
        self,
        session: AsyncSession,
        grid_id: int,
        *,
        options: Sequence[_AbstractLoad] | None = None,
    ) -> Sequence[models.DivisionGridVersion]:
        query = self._apply_options(
            self.select()
            .where(models.DivisionGridVersion.grid_id == grid_id)
            .order_by(models.DivisionGridVersion.version),
            options,
        )
        result = await session.execute(query)
        return result.unique().scalars().all()

    async def get_next_version(self, session: AsyncSession, grid_id: int) -> int:
        result = await session.execute(
            sa.select(sa.func.coalesce(sa.func.max(models.DivisionGridVersion.version), 0)).where(
                models.DivisionGridVersion.grid_id == grid_id
            )
        )
        return int(result.scalar_one()) + 1


class DivisionGridTierRepository(BaseRepository[models.DivisionGridTier]):
    def __init__(self) -> None:
        super().__init__(models.DivisionGridTier)

    async def list_by_version(
        self,
        session: AsyncSession,
        version_id: int,
        *,
        options: Sequence[_AbstractLoad] | None = None,
    ) -> Sequence[models.DivisionGridTier]:
        query = self._apply_options(
            self.select()
            .where(models.DivisionGridTier.version_id == version_id)
            .order_by(models.DivisionGridTier.sort_order),
            options,
        )
        result = await session.execute(query)
        return result.unique().scalars().all()

    async def list_ids_by_version(
        self, session: AsyncSession, version_id: int
    ) -> Sequence[int]:
        result = await session.execute(
            sa.select(models.DivisionGridTier.id).where(
                models.DivisionGridTier.version_id == version_id
            )
        )
        return result.scalars().all()


class DivisionGridMappingRepository(BaseRepository[models.DivisionGridMapping]):
    def __init__(self) -> None:
        super().__init__(models.DivisionGridMapping)

    async def get_for_versions(
        self,
        session: AsyncSession,
        *,
        source_version_id: int,
        target_version_id: int,
        options: Sequence[_AbstractLoad] | None = None,
    ) -> models.DivisionGridMapping | None:
        return await self.get_by(
            session,
            options=options,
            source_version_id=source_version_id,
            target_version_id=target_version_id,
        )

    async def set_completeness(
        self, session: AsyncSession, mapping_id: int, *, is_complete: bool
    ) -> None:
        await session.execute(
            sa.update(models.DivisionGridMapping)
            .where(models.DivisionGridMapping.id == mapping_id)
            .values(is_complete=is_complete)
        )

    async def mark_incomplete_for_version(
        self, session: AsyncSession, version_id: int
    ) -> None:
        """Invalidate every mapping touching a version, on either side, in one statement.

        Editing a version's tiers can only make existing mappings stale, and a version
        is both a source and a target in different mappings — hence the ``OR`` over the
        two FK columns. Kept bulk on purpose: fanning this out to per-id
        ``set_completeness`` calls would turn one statement into N.
        """
        mapping = models.DivisionGridMapping
        await session.execute(
            sa.update(mapping)
            .where(
                sa.or_(
                    mapping.source_version_id == version_id,
                    mapping.target_version_id == version_id,
                )
            )
            .values(is_complete=False)
        )


class DivisionGridMappingRuleRepository(BaseRepository[models.DivisionGridMappingRule]):
    def __init__(self) -> None:
        super().__init__(models.DivisionGridMappingRule)

    async def delete_for_mapping(self, session: AsyncSession, mapping_id: int) -> None:
        await session.execute(
            sa.delete(models.DivisionGridMappingRule).where(
                models.DivisionGridMappingRule.mapping_id == mapping_id
            )
        )


class DivisionGridImportJobRepository(BaseRepository[models.DivisionGridImportJob]):
    """Marketplace grid-import queue (``division_grid_import_job``)."""

    def __init__(self) -> None:
        super().__init__(models.DivisionGridImportJob)

    async def get_by_idempotency_key(
        self, session: AsyncSession, idempotency_key: str
    ) -> models.DivisionGridImportJob | None:
        return await self.get_by(session, idempotency_key=idempotency_key)

    async def get_for_workspace(
        self, session: AsyncSession, *, job_id: int, workspace_id: int
    ) -> models.DivisionGridImportJob | None:
        return await self.get_by(session, id=job_id, workspace_id=workspace_id)

    async def list_for_workspace(
        self,
        session: AsyncSession,
        workspace_id: int,
        *,
        statuses: Sequence[str] | None = None,
        limit: int | None = None,
    ) -> Sequence[models.DivisionGridImportJob]:
        filters: list[sa.ColumnElement[bool]] = [
            models.DivisionGridImportJob.workspace_id == workspace_id
        ]
        if statuses is not None:
            filters.append(models.DivisionGridImportJob.status.in_(tuple(statuses)))
        query = self.select().where(*filters).order_by(models.DivisionGridImportJob.id.desc())
        if limit is not None:
            query = query.limit(limit)
        result = await session.execute(query)
        return result.scalars().all()

    async def list_stalled(
        self, session: AsyncSession, *, cutoff: datetime, status: str = "running"
    ) -> Sequence[models.DivisionGridImportJob]:
        result = await session.execute(
            self.select().where(
                models.DivisionGridImportJob.status == status,
                models.DivisionGridImportJob.started_at < cutoff,
            )
        )
        return result.scalars().all()

    async def claim_queued(
        self,
        session: AsyncSession,
        job_id: int,
        *,
        from_status: str,
        to_status: str,
        started_at: datetime,
        extra_values: dict[str, Any] | None = None,
    ) -> bool:
        """Conditional status transition — the claim race between pollers.

        Returns ``True`` only for the caller whose UPDATE actually matched, so a job
        is never picked up twice. Preserved as a single conditional statement on
        purpose: a read-then-write would reintroduce the race.

        ``extra_values`` rides in the *same* statement so per-attempt resets
        (``progress``, ``error``, ``finished_at``) commit atomically with the claim —
        setting them on the loaded row afterwards would leave a window where a job
        reads as claimed but still carries the previous attempt's error.
        """
        values: dict[str, Any] = {"status": to_status, "started_at": started_at}
        if extra_values:
            values.update(extra_values)
        result = await session.execute(
            sa.update(models.DivisionGridImportJob)
            .where(
                models.DivisionGridImportJob.id == job_id,
                models.DivisionGridImportJob.status == from_status,
            )
            .values(**values)
            .execution_options(synchronize_session="evaluate")
        )
        return bool(result.rowcount == 1)


__all__ = (
    "DivisionGridImportJobRepository",
    "DivisionGridMappingRepository",
    "DivisionGridMappingRuleRepository",
    "DivisionGridTierRepository",
    "DivisionGridVersionRepository",
)
