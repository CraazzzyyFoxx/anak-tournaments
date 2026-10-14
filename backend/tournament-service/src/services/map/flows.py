"""Minimal map read-model surface for tournament-service.

Map statistics/top-user flows live in app-service; encounter flows only need
``to_pydantic`` to embed a map into match read models.
"""

from sqlalchemy.ext.asyncio import AsyncSession

from src import models, schemas


def map_to_read(map: models.CatalogEntity, entities: list[str]) -> schemas.MapRead:
    """Project the OW-shaped map read; ``gamemode`` requires the parent already loaded."""
    return schemas.MapRead.from_entity(map, with_gamemode="gamemode" in entities)


class MapFlowsService:
    async def to_pydantic(
        self, session: AsyncSession, map: models.CatalogEntity, entities: list[str]
    ) -> schemas.MapRead:
        """
        Converts a Map model instance to a Pydantic schema (MapRead), including related entities.

        Parameters:
            session (AsyncSession): The SQLAlchemy async session.
            map (models.CatalogEntity): The map entity to convert.
            entities (list[str]): A list of related entities to include (e.g., ["gamemode"]).

        Returns:
            schemas.MapRead: The Pydantic schema representing the map.
        """
        return map_to_read(map, entities)


flows_service = MapFlowsService()
