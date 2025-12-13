import typing

import sqlalchemy as sa
from sqlalchemy.orm.strategy_options import _AbstractLoad

__all__ = (
    "prepare_entities",
    "join_entity",
)


def prepare_entities(in_entities: list[str], parent: str) -> list[str]:
    entities: list[str] = []
    for entity in in_entities:
        if entity.startswith(f"{parent}."):
            entities.append(entity.replace(f"{parent}.", ""))
    return entities


def join_entity(child: typing.Any, entity: typing.Any) -> _AbstractLoad:
    if child:
        return child.joinedload(entity)  # noqa
    return sa.orm.joinedload(entity)
