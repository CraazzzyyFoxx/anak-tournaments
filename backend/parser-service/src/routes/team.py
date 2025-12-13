import json
import typing

from fastapi import APIRouter, Depends, UploadFile

from src import schemas
from src.core import auth, db, enums
from src.services.team import flows as team_flows

router = APIRouter(
    prefix="/teams",
    tags=[enums.RouteTag.TEAMS],
    dependencies=[Depends(auth.require_role("admin"))],
)


@router.post(path="/create/balancer")
async def bulk_create_from_balancer(
    tournament_id: int,
    data: UploadFile,
    payload_format: typing.Literal["atravkovs", "internal"] = "atravkovs",
    session=Depends(db.get_async_session),
):
    text = await data.read()
    payload = json.loads(text)

    if payload_format == "atravkovs":
        teams = [schemas.BalancerTeam.model_validate(team) for team in payload["data"]["teams"]]
    else:
        internal_payload = schemas.InternalBalancerTeamsPayload.model_validate(payload)
        teams = [team.to_balancer_team() for team in internal_payload.teams]

    return await team_flows.bulk_create_from_balancer(session, tournament_id, teams)


@router.post(path="/create/challonge")
async def create_from_challonge(
    tournament_id: int,
    name_mapper: dict[str, str],
    session=Depends(db.get_async_session),
):
    await team_flows.bulk_create_for_tournament_from_challonge(session, tournament_id, name_mapper)
    return {"message": "Teams created successfully"}


@router.post(path="/create/challonge/bulk")
async def bulk_create_from_challonge(
    name_mapper: dict[str, str],
    session=Depends(db.get_async_session),
):
    await team_flows.bulk_create_from_challonge(session, name_mapper)
    return {"message": "Teams created successfully"}
