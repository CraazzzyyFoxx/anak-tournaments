"""Map domain: name/alias resolution and reads; catalog sync belongs to the discipline module."""

from __future__ import annotations

import typing

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm.strategy_options import _AbstractLoad

from shared.repository import CatalogEntityRepository
from src import models
from src.core import utils
from src.services import catalog_aliases

__all__ = ("MapService", "map_service", "map_entities")


def map_entities(in_entities: list[str], child: typing.Any | None = None) -> list[_AbstractLoad]:
    entities = []
    if "gamemode" in in_entities:
        entities.append(utils.join_entity(child, models.CatalogEntity.parent))

    return entities


class MapService:
    def __init__(
        self, *, repo: CatalogEntityRepository = CatalogEntityRepository("map", discipline=catalog_aliases.DISCIPLINE)
    ) -> None:
        self.repo = repo

    async def get_by_name_or_alias_and_gamemode(
        self, session: AsyncSession, name: str, gamemode: str
    ) -> models.CatalogEntity | None:
        """Thin wrapper over the repository — it owns the predicate so the SQL
        stays assertable without a database."""
        return await self.repo.get_map_by_name_or_alias(
            session, discipline=catalog_aliases.DISCIPLINE, name=name, mode_name=gamemode
        )


map_service = MapService()
