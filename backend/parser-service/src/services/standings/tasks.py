from sqlalchemy.ext.asyncio import AsyncSession

from src.core import pagination
from src.services.tournament import service as tournament_service

from . import flows


async def bulk_create(session: AsyncSession) -> None:
    tournaments = await tournament_service.get_all(session)
    for tournament in tournaments:
        await flows.bulk_create_for_tournament(session, tournament.id)
