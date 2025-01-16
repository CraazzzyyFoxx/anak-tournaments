import typing

import sqlalchemy as sa
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm.strategy_options import _AbstractLoad

from src import models
from src.core import utils
from src.services.team import service as team_service


def standing_entities(in_entities: list[str]) -> list[_AbstractLoad]:
    """
    Generates a list of SQLAlchemy loading options for related entities of a standing.

    Parameters:
        in_entities (list[str]): A list of entity names to load (e.g., ["tournament", "group", "team"]).

    Returns:
        list[_AbstractLoad]: A list of SQLAlchemy loading options.
    """
    entities = []
    if "tournament" in in_entities:
        entities.append(sa.orm.joinedload(models.Standing.tournament))
    if "group" in in_entities:
        entities.append(sa.orm.joinedload(models.Standing.group))
    if "team" in in_entities:
        team = sa.orm.joinedload(models.Standing.team)
        entities.append(team)
        team_entities = utils.prepare_entities(in_entities, "team")
        entities.extend(team_service.team_entities(team_entities, team))

    return entities


async def get_by_tournament(
    session: AsyncSession, tournament: models.Tournament, entities: list[str]
) -> typing.Sequence[models.Standing]:
    """
    Retrieves all standings for a specific tournament.

    Parameters:
        session (AsyncSession): The SQLAlchemy async session.
        tournament (models.Tournament): The Tournament model instance for which to retrieve standings.
        entities (list[str]): A list of related entities to load (e.g., ["tournament", "group", "team"]).

    Returns:
        typing.Sequence[models.Standing]: A sequence of Standing objects for the specified tournament.
    """
    query = (
        sa.select(models.Standing)
        .options(*standing_entities(entities))
        .where(
            sa.and_(
                models.Standing.tournament_id == tournament.id,
            )
        )
        .order_by(models.Standing.overall_position)
    )
    result = await session.execute(query)
    return result.unique().scalars().all()
