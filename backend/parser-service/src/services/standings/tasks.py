from sqlalchemy.ext.asyncio import AsyncSession

from src.core import db
from src.services.tournament import service as tournament_service

from . import flows


async def bulk_create(session: AsyncSession) -> None:
    tournaments = await tournament_service.get_all(session, is_finished=False)
    for tournament in tournaments:
        await flows.bulk_create_for_tournament(session, tournament.id, rewrite=True)


async def bulk_create_all() -> None:
    async with db.async_session_maker() as session:
        await bulk_create(session)
