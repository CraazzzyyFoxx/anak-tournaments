"""Public native catalog reads: one discipline's characters, maps or modes, by id or as a page.

Reuses the admin repository scoping and validation (``services/admin/catalog``) but none of its authorization: the
catalog is global game content and these reads are public. A row of another discipline or kind is a 404, never an entity
with a rewritten label.
"""

from __future__ import annotations

from dataclasses import replace

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from shared import models
from shared.core import http_status as status
from shared.core.errors import ApiExc, ApiHTTPException
from shared.repository import CatalogEntityRepository
from src import schemas
from src.services.admin.catalog import catalog as admin_catalog
from src.services.admin.catalog import kind_spec, to_read

__all__ = ("get_entity", "list_entities")

_WITH_PARENT = [selectinload(models.CatalogEntity.parent)]


async def list_entities(
    session: AsyncSession, discipline: str, kind: str, params: schemas.CatalogEntityListParams
) -> dict:
    """A page of ``kind`` rows of ``discipline``; active rows only unless the caller asks for ``active=false``."""
    if params.active is None:
        params = replace(params, active=True)
    return await admin_catalog.list(session, discipline, kind, params)


async def get_entity(session: AsyncSession, discipline: str, kind: str, entity_id: int) -> schemas.CatalogEntityRead:
    """One row with its parent expanded; inactive rows are readable (a stored reference may point at one)."""
    kind_spec(discipline, kind)
    entity = await CatalogEntityRepository(kind, discipline=discipline).get(session, entity_id, options=_WITH_PARENT)
    if entity is None:
        raise ApiHTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=[ApiExc(code="not_found", msg=f"No {kind} {entity_id} in discipline {discipline!r}")],
        )
    return to_read(entity)
