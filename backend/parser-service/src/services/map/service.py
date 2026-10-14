"""Map domain: name/alias resolution and reads; catalog sync belongs to the discipline module."""

from __future__ import annotations

import typing

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm.strategy_options import _AbstractLoad

from shared.repository import MapRepository
from src import models, schemas
from src.core import errors, utils
from src.services import catalog_aliases

__all__ = ("MapService", "map_service", "map_entities", "to_pydantic")


def map_entities(in_entities: list[str], child: typing.Any | None = None) -> list[_AbstractLoad]:
    entities = []
    if "gamemode" in in_entities:
        entities.append(utils.join_entity(child, models.Map.gamemode))

    return entities


def to_pydantic(map: models.Map, entities: list[str]) -> schemas.MapRead:
    gamemode: schemas.GamemodeRead | None = None
    if "gamemode" in entities:
        gamemode = schemas.GamemodeRead(**map.gamemode.to_dict())
    return schemas.MapRead(
        id=map.id,
        name=map.name,
        image_path=map.image_path,
        gamemode=gamemode,
    )


class MapService:
    def __init__(self, *, repo: MapRepository = MapRepository()) -> None:
        self.repo = repo

    async def get_by_names(self, session: AsyncSession, names: list[str]) -> dict[str, models.Map]:
        """All maps whose name is in ``names``, indexed by name, in one query."""
        return await self.repo.get_many_by(session, models.Map.name, names)

    async def get_by_name_or_alias_and_gamemode(
        self, session: AsyncSession, name: str, gamemode: str
    ) -> models.Map | None:
        """Thin wrapper over the repository — it owns the predicate so the SQL
        stays assertable without a database."""
        return await self.repo.get_by_name_or_alias_and_gamemode(session, name=name, gamemode=gamemode)

    async def resolve_by_name_or_alias_and_gamemode(
        self, session: AsyncSession, name: str, gamemode: str, *, log_record_id: int | None = None
    ) -> models.Map:
        """Resolve a log's raw map + gamemode names through `name` or `aliases`."""
        map = await self.get_by_name_or_alias_and_gamemode(session, name, gamemode)
        if not map:
            # Recorded BEFORE the raise and in its own transaction: the 404 rolls
            # the log-processing session back. Both names go in — a failed join
            # cannot tell which of the two was the unknown one.
            await catalog_aliases.record_misses("map", [name], log_record_id=log_record_id)
            await catalog_aliases.record_misses("mode", [gamemode], log_record_id=log_record_id)
            raise errors.ApiHTTPException(
                status_code=404,
                detail=[
                    errors.ApiExc(
                        code="not_found",
                        msg=f"Map with name {name} and gamemode {gamemode} not found",
                    ),
                ],
            )
        return map


map_service = MapService()
