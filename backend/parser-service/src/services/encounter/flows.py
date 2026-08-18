
from sqlalchemy.ext.asyncio import AsyncSession

from src import models
from src.core import errors

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



