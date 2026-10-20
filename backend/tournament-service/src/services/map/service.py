"""Minimal map query surface for tournament-service.

Only the loader-options helper lives here; the map read layer (listing,
per-user map stats) lives in app-service.
"""

import typing

from sqlalchemy.orm.strategy_options import _AbstractLoad

from src import models
from src.core import utils

__all__ = ("map_entities",)


def map_entities(in_entities: list[str], child: typing.Any | None = None) -> list[_AbstractLoad]:
    """Loader options for a map's requested relations; ``child`` chains them under a parent load."""
    entities = []
    if "gamemode" in in_entities:
        entities.append(utils.join_entity(child, models.CatalogEntity.parent))

    return entities
