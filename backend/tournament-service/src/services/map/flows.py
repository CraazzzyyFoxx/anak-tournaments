"""Minimal map read-model surface for tournament-service.

Map statistics/top-user flows live in app-service; encounter flows only need
``to_pydantic`` to embed a map into match read models.
"""

from sqlalchemy.ext.asyncio import AsyncSession

from shared.schemas.catalog import CatalogEntityRead
from src import models


def map_to_read(map: models.CatalogEntity, entities: list[str]) -> CatalogEntityRead:
    """The native catalog read of a map; ``parent`` (its mode) requires the parent already loaded."""
    return CatalogEntityRead.from_entity(map, with_parent="parent" in entities)


class MapFlowsService:
    async def to_pydantic(
        self, session: AsyncSession, map: models.CatalogEntity, entities: list[str]
    ) -> CatalogEntityRead:
        """
        Converts a map catalog entity to its native read, including related entities.

        Parameters:
            session (AsyncSession): The SQLAlchemy async session.
            map (models.CatalogEntity): The map entity to convert.
            entities (list[str]): A list of related entities to include (e.g., ["parent"]).

        Returns:
            CatalogEntityRead: The native catalog entity of the map.
        """
        return map_to_read(map, entities)


flows_service = MapFlowsService()
