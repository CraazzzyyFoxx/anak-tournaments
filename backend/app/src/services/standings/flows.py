import typing

from sqlalchemy.ext.asyncio import AsyncSession

from src import models, schemas
from src.core import utils
from src.services.encounter import flows as encounter_flows
from src.services.team import flows as team_flows
from src.services.tournament import flows as tournament_flows

from . import service


def sort_matches(
    matches: typing.Sequence[schemas.EncounterRead],
) -> list[schemas.EncounterRead]:
    max_abs_round = max(abs(match.round) for match in matches)

    def sort_key(match):
        final_flag = 1 if abs(match.round) == max_abs_round else 0
        return final_flag, abs(match.round), 0 if match.round > 0 else 1

    return sorted(matches, key=sort_key)


async def to_pydantic(
    session: AsyncSession, standing: models.Standing, entities: list[str]
) -> schemas.StandingRead:
    """
    Converts a Standing model instance to a Pydantic schema (StandingRead), including related entities.

    Parameters:
        session (AsyncSession): The SQLAlchemy async session.
        standing (models.Standing): The Standing model instance to convert.
        entities (list[str]): A list of related entities to include (e.g., ["team", "group", "tournament", "matches_history"]).

    Returns:
        schemas.StandingRead: The Pydantic schema representing the standing.
    """
    team: schemas.TeamRead | None = None
    group: schemas.TournamentGroupRead | None = None
    tournament: schemas.TournamentRead | None = None
    matches_history: list[schemas.EncounterRead] = []

    if "team" in entities:
        team = await team_flows.to_pydantic(
            session, standing.team, utils.prepare_entities(entities, "team")
        )
    if "group" in entities:
        group = await tournament_flows.to_pydantic_group(session, standing.group, [])
    if "tournament" in entities:
        tournament = await tournament_flows.to_pydantic(
            session, standing.tournament, []
        )
    if "matches_history" in entities:
        matches_history = await encounter_flows.get_encounters_by_team_group(
            session, standing.team_id, standing.group_id, entities
        )

    return schemas.StandingRead(
        **standing.to_dict(),
        team=team,
        group=group,
        tournament=tournament,
        matches_history=sort_matches(matches_history),
    )


async def get_by_tournament(
    session: AsyncSession, tournament: models.Tournament, entities: list[str]
) -> list[schemas.StandingRead]:
    """
    Retrieves all standings for a specific tournament and converts them to Pydantic schemas.

    Parameters:
        session (AsyncSession): The SQLAlchemy async session.
        tournament (models.Tournament): The Tournament model instance for which to retrieve standings.
        entities (list[str]): A list of related entities to include (e.g., ["team", "group", "tournament", "matches_history"]).

    Returns:
        list[schemas.StandingRead]: A list of Pydantic schemas representing the standings.
    """
    standings = await service.get_by_tournament(session, tournament, entities)
    return [await to_pydantic(session, standing, entities) for standing in standings]
