"""The catalog alias-miss queue: list what is unresolved, attach a raw name to
the entity it meant, or dismiss it.

The parser resolves hero/map/gamemode names from the canonical ``name`` plus the
``aliases`` JSONB list; a name that resolves to neither is upserted into
``catalog.alias_miss`` with an occurrence counter. This module is the
other end of that pipe. Canonical documents add three diagnostic-only kinds
(``stat``/``event``/``role``): they are listed and dismissed here, never
attached, because attach is addressed to a catalog entity.

``attach`` is a dedicated operation rather than a ``PATCH aliases=[…]`` from the
browser for two reasons: appending client-side is a read-modify-write two admins
would race, and attaching an alias must close the matching miss row in the same
transaction — which this service owns.
"""

from __future__ import annotations

import sqlalchemy as sa
from sqlalchemy.ext.asyncio import AsyncSession

from shared import models
from shared.catalog_aliases import normalize_aliases
from shared.core import http_status as status
from shared.core.errors import BaseAPIException as HTTPException
from shared.repository import CatalogAliasMissRepository, CatalogEntityRepository
from src import schemas

__all__ = ("CatalogAliasService", "catalog_aliases")


class CatalogAliasService:
    """The alias-miss worklist: the LEFT-JOINed read plus the two transactional operations."""

    def __init__(
        self,
        *,
        misses: CatalogAliasMissRepository = CatalogAliasMissRepository(),
        entities: CatalogEntityRepository = CatalogEntityRepository(),
    ) -> None:
        self.misses = misses
        self.entities = entities

    async def list_misses(self, session: AsyncSession, params: schemas.CatalogAliasMissListParams) -> dict:
        miss = models.CatalogAliasMiss
        filters: list[sa.ColumnElement[bool]] = []
        if not params.include_resolved:
            filters.append(miss.resolved_at.is_(None))
        if params.discipline is not None:
            filters.append(miss.discipline == params.discipline)
        if params.kind is not None:
            filters.append(miss.kind == params.kind)

        total = await session.scalar(sa.select(sa.func.count()).select_from(miss).where(*filters)) or 0
        # The breadcrumb remains the real ingest job; its tournament hint locates
        # the admin history page even when no match has been bound yet.
        # Ordering is fixed rather than driven by the inherited `sort`/`order`: this is
        # a worklist, so the name costing the most data comes first.
        job = models.IngestJob
        query = (
            sa.select(miss, job.hint_tournament_id)
            .outerjoin(job, sa.and_(job.id == miss.last_ingest_job_id, job.discipline == miss.discipline))
            .where(*filters)
            .order_by(miss.occurrences.desc(), miss.last_seen_at.desc(), miss.id.desc())
        )
        rows = (await session.execute(params.apply_pagination(query))).all()

        return {
            "results": [
                schemas.CatalogAliasMissRead.model_validate(row, from_attributes=True).model_copy(
                    update={"last_log_tournament_id": tournament_id}
                )
                for row, tournament_id in rows
            ],
            "total": total,
            "page": params.page,
            "per_page": params.per_page,
        }

    async def attach(self, session: AsyncSession, data: schemas.CatalogAliasAttach) -> None:
        """Add ``alias`` to the entity's ``aliases`` and close the matching miss, atomically."""
        entity = await self.entities.get(session, data.entity_id)
        if entity is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Catalog entity not found")
        # JSONB does not track in-place mutation: reassign. `canonical` drops the entity's own name.
        entity.aliases = normalize_aliases([*entity.aliases, data.alias], canonical=entity.name)
        await self.misses.resolve_by_raw_name(
            session, discipline=entity.discipline, kind=entity.kind, raw_name=data.alias
        )
        await session.commit()

    async def dismiss(self, session: AsyncSession, miss_id: int) -> None:
        miss = await self.misses.get(session, miss_id)
        if miss is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Alias miss not found")

        miss.resolved_at = sa.func.now()
        await session.commit()


catalog_aliases = CatalogAliasService()
