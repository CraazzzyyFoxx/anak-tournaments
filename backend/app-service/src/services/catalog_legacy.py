"""Old catalog ids → new ones, for the redirect of old links. Goes with ``catalog.entity_legacy`` in migration
``discipline02``."""

from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncSession

from shared.core import errors
from shared.repository import CatalogEntityRepository
from src import schemas

__all__ = ("resolve",)

_LEGACY_KINDS = frozenset({"hero", "map", "gamemode"})
_entities = CatalogEntityRepository()


async def resolve(session: AsyncSession | None, legacy_kind: str, legacy_id: str) -> schemas.CatalogLegacyRead:
    entity = None
    if legacy_kind in _LEGACY_KINDS and legacy_id.isascii() and legacy_id.isdigit():
        digits = legacy_id.lstrip("0")
        if 0 < len(digits) <= 19 and (parsed_id := int(digits)) <= 2**63 - 1:
            entity = await _entities.get_by_legacy_id(session, legacy_kind, parsed_id)
    if entity is None:
        raise errors.ApiHTTPException(
            status_code=404,
            detail=[errors.ApiExc(code="not_found", msg=f"No catalog entry was {legacy_kind} #{legacy_id}")],
        )
    return schemas.CatalogLegacyRead(
        entity_id=entity.id, discipline=entity.discipline, kind=entity.kind, slug=entity.slug
    )
