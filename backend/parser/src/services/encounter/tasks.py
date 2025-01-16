from src.core import db

from src.services.tournament import service as tournament_service

from . import flows


async def bulk_create() -> None:
    async with db.async_session_maker() as session:
        tournaments = await tournament_service.get_all(session)
        for tournament in tournaments:
            await flows.bulk_create_for_tournament_from_challonge(session, tournament.id)
