import typing

import sqlalchemy as sa
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm.strategy_options import _AbstractLoad

from shared.repository import MapRepository
from src import models
from src.core import utils

_map_repo = MapRepository()


def map_entities(in_entities: list[str], child: typing.Any | None = None) -> list[_AbstractLoad]:
    entities = []
    if "gamemode" in in_entities:
        entities.append(utils.join_entity(child, models.Map.gamemode))

    return entities






async def get_by_names(session: AsyncSession, names: list[str]) -> dict[str, models.Map]:
    """All maps whose name is in ``names``, indexed by name, in one query
    (batch counterpart of the per-item ``get_by_name`` probes in
    ``initial_create``). On duplicate names the first row wins."""
    if not names:
        return {}
    result = await session.execute(sa.select(models.Map).where(models.Map.name.in_(list(set(names)))))
    maps: dict[str, models.Map] = {}
    for map in result.scalars().all():
        maps.setdefault(map.name, map)
    return maps


async def get_by_name_or_alias_and_gamemode(session: AsyncSession, name: str, gamemode: str) -> models.Map | None:
    """Resolve a map by name-or-alias inside a gamemode by name-or-alias.

    Thin wrapper over the repository — it owns the predicate so the SQL stays
    assertable without a database.
    """
    return await _map_repo.get_by_name_or_alias_and_gamemode(session, name=name, gamemode=gamemode)




