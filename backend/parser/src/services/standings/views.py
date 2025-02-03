from fastapi import APIRouter, Depends

from src.core import db, enums
from src import schemas

from src.services.auth import flows as auth_flows

from . import flows

router = APIRouter(
    prefix="/standing",
    tags=[enums.RouteTag.STANDINGS],
    dependencies=[Depends(auth_flows.current_user)],
)


@router.post(path="/create", response_model=list[schemas.StandingRead])
async def bulk_create_from_tournament(
    tournament_id: int,
    rewrite: bool = False,
    session=Depends(db.get_async_session),
):
    return await flows.bulk_create_for_tournament(session, tournament_id, rewrite)


@router.post(path="/create/bulk")
async def bulk_create_from_tournament(session=Depends(db.get_async_session)):
    return await flows.bulk_create(session)
