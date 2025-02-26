import orjson
from fastapi import APIRouter, Depends, UploadFile

from src import schemas
from src.core import db, enums
from src.services.auth import flows as auth_flows

from . import flows

router = APIRouter(
    prefix="/teams",
    tags=[enums.RouteTag.TEAMS],
    dependencies=[Depends(auth_flows.current_user)],
)


@router.post(path="/create/balancer")
async def bulk_create_from_balancer(
    tournament_id: int,
    data: UploadFile,
    session=Depends(db.get_async_session),
):
    text = await data.read()
    payload = orjson.loads(text)
    teams = [
        schemas.BalancerTeam.model_validate(team) for team in payload["data"]["teams"]
    ]
    return await flows.bulk_create_from_balancer(session, tournament_id, teams)


@router.post(path="/create/challonge")
async def create_from_challonge(
    tournament_id: int,
    name_mapper: dict[str, str],
    session=Depends(db.get_async_session),
):
    await flows.bulk_create_for_tournament_from_challonge(
        session, tournament_id, name_mapper
    )
    return {"message": "Teams created successfully"}


@router.post(path="/create/challonge/bulk")
async def bulk_create_from_challonge(
    name_mapper: dict[str, str],
    session=Depends(db.get_async_session),
):
    await flows.bulk_create_from_challonge(session, name_mapper)
    return {"message": "Teams created successfully"}
