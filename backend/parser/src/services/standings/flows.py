from sqlalchemy.ext.asyncio import AsyncSession
from loguru import logger

from src import models, schemas
from src.services.tournament import flows as tournament_flows
from src.services.tournament import service as tournament_service

from . import service


async def to_pydantic(session: AsyncSession, standing: models.Standing, entities: list[str]) -> schemas.StandingRead:
    team: schemas.TeamRead | None = None
    group: schemas.TournamentGroupRead | None = None
    tournament: schemas.TournamentRead | None = None

    if "group" in entities:
        group = await tournament_flows.to_pydantic_group(session, standing.group, [])
    if "tournament" in entities:
        tournament = await tournament_flows.to_pydantic(session, standing.tournament, [])

    return schemas.StandingRead(**standing.to_dict(), team=team, group=group, tournament=tournament)


async def bulk_create_for_tournament(
    session: AsyncSession,
    tournament_id: int,
    rewrite: bool = False,
) -> list[schemas.StandingRead]:
    if rewrite:
        await service.delete_by_tournament(session, tournament_id)

    tournament = await tournament_flows.get(session, tournament_id, ["groups"])
    if await service.get_by_tournament(session, tournament, []):
        logger.info(f"Standings for tournament {tournament_id} already exist. Skipping...")
        return []
    standings = await service.calculate_for_tournament(session, tournament)
    return [await to_pydantic(session, standing, ["team"]) for standing in standings]


async def bulk_create(session: AsyncSession) -> None:
    for tournament in await tournament_service.get_all(session):
        await bulk_create_for_tournament(session, tournament.id)
