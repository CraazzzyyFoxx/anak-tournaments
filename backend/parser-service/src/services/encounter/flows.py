
from loguru import logger
from sqlalchemy.ext.asyncio import AsyncSession

from src import models
from src.core import errors
from src.services.challonge import sync as challonge_sync

from . import service


async def get_by_teams_ids(
    session: AsyncSession,
    home_team_id: int,
    away_team_id: int,
    entities: list[str],
    *,
    has_closeness: bool | None = None,
) -> models.Encounter:
    encounter = await service.get_by_teams(session, home_team_id, away_team_id, entities, has_closeness=has_closeness)
    if not encounter:
        raise errors.ApiHTTPException(
            status_code=404,
            detail=[
                errors.ApiExc(
                    code="not_found",
                    msg=f"Encounter with teams [{home_team_id}, {away_team_id}] not found",
                )
            ],
        )
    return encounter




async def bulk_create_for_tournament_from_challonge(
    session: AsyncSession,
    tournament_id: int,
    skip_finals: bool = False,
) -> dict:
    if skip_finals:
        logger.warning("skip_finals is ignored by unified Challonge import")
    return await challonge_sync.import_tournament(session, tournament_id)


