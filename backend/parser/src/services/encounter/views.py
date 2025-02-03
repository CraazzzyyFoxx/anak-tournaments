from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from src.core import db, enums

from src.services.auth import flows as auth_flows

from . import flows

router = APIRouter(
    prefix="/encounter",
    tags=[enums.RouteTag.ENCOUNTER],
    dependencies=[Depends(auth_flows.current_user)],
)


@router.post(path="/bulk")
async def bulk_create_from_challonge(
    session: AsyncSession = Depends(db.get_async_session),
):
    await flows.bulk_create_for_from_challonge(session)
    return {"message": "Encounters creation started"}


@router.post(path="/challonge")
async def create_from_challonge(
    tournament_id: int,
    skip_finals: bool = False,  # Thanks 4 tournament
    session: AsyncSession = Depends(db.get_async_session),
):
    await flows.bulk_create_for_tournament_from_challonge(session, tournament_id)
    return {"message": "Encounters created successfully"}
