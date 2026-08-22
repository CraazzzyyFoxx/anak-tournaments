"""The catalog alias-miss queue: list what is unresolved, attach a raw name to
the entity it meant, or dismiss it.

The parser resolves hero/map/gamemode names from the canonical ``name`` plus the
``aliases`` JSONB list; a name that resolves to neither is upserted into
``overwatch.catalog_alias_miss`` with an occurrence counter. This module is the
other end of that pipe.

``attach`` is a dedicated operation rather than a ``PATCH aliases=[…]`` from the
browser for two reasons: appending client-side is a read-modify-write two admins
would race, and attaching an alias must close the matching miss row in the same
transaction — which this service owns.
"""

from __future__ import annotations

import sqlalchemy as sa
from sqlalchemy.ext.asyncio import AsyncSession

from shared.catalog_aliases import normalize_aliases
from shared.core import enums
from shared.core import http_status as status
from shared.core.errors import BaseAPIException as HTTPException
from shared.repository import (
    BaseRepository,
    CatalogAliasMissRepository,
    GamemodeRepository,
    HeroRepository,
    MapRepository,
)
from src import models
from src.schemas.admin import catalog_alias as alias_schemas

__all__ = ("CatalogAliasService", "catalog_aliases")

# The three catalog tables that carry an `aliases` column, keyed by the enum the
# miss row and the attach payload both use. Repositories rather than model
# classes: `attach` needs a `get`, not a dynamic `session.get(model, id)`.
ENTITY_REPOSITORIES: dict[enums.CatalogEntityType, BaseRepository] = {
    enums.CatalogEntityType.hero: HeroRepository(),
    enums.CatalogEntityType.map: MapRepository(),
    enums.CatalogEntityType.gamemode: GamemodeRepository(),
}


class CatalogAliasService:
    """The alias-miss worklist: the LEFT-JOINed read (analytical, so it does not
    belong behind a CRUD repository) plus the two transactional operations."""

    def __init__(
        self,
        *,
        misses: CatalogAliasMissRepository = CatalogAliasMissRepository(),
        entities: dict[enums.CatalogEntityType, BaseRepository] | None = None,
    ) -> None:
        self.misses = misses
        self.entities = ENTITY_REPOSITORIES if entities is None else entities

    async def list_misses(self, session: AsyncSession, params: alias_schemas.CatalogAliasMissListParams) -> dict:
        miss = models.CatalogAliasMiss
        filters: list[sa.ColumnElement[bool]] = []
        if not params.include_resolved:
            filters.append(miss.resolved_at.is_(None))
        if params.entity_type is not None:
            filters.append(miss.entity_type == params.entity_type)

        total = await session.scalar(sa.select(sa.func.count()).select_from(miss).where(*filters)) or 0
        # LEFT JOIN for the tournament: a log record is only addressable in the admin
        # UI as /admin/tournaments/{id}/matches/logs, so the bare record id is useless
        # on its own. NULL when no record was recorded or the record was since deleted.
        # Ordering is fixed rather than driven by the inherited `sort`/`order`: this is
        # a worklist, so the name costing the most data comes first.
        record = models.LogProcessingRecord
        query = (
            sa.select(miss, record.tournament_id)
            .outerjoin(record, record.id == miss.last_log_record_id)
            .where(*filters)
            .order_by(miss.occurrences.desc(), miss.last_seen_at.desc(), miss.id.desc())
        )
        rows = (await session.execute(params.apply_pagination(query))).all()

        return {
            "results": [
                alias_schemas.CatalogAliasMissRead.model_validate(row, from_attributes=True).model_copy(
                    update={"last_log_tournament_id": tournament_id}
                )
                for row, tournament_id in rows
            ],
            "total": total,
            "page": params.page,
            "per_page": params.per_page,
        }

    async def attach(self, session: AsyncSession, data: alias_schemas.CatalogAliasAttach) -> None:
        """Add ``alias`` to the entity's ``aliases`` and close the matching miss, atomically."""
        obj = await self.entities[data.entity_type].get(session, data.entity_id)
        if obj is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"{data.entity_type.value.capitalize()} not found",
            )

        # JSONB does not track in-place mutation: `obj.aliases.append(...)` never
        # reaches the UPDATE. Reassign. `canonical` drops an attach of the entity's
        # own name, which the lookup already matches on.
        obj.aliases = normalize_aliases([*obj.aliases, data.alias], canonical=obj.name)

        await self.misses.resolve_by_raw_name(session, entity_type=data.entity_type, raw_name=data.alias)
        await session.commit()

    async def dismiss(self, session: AsyncSession, miss_id: int) -> None:
        miss = await self.misses.get(session, miss_id)
        if miss is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Alias miss not found")

        miss.resolved_at = sa.func.now()
        await session.commit()


catalog_aliases = CatalogAliasService()
