from fastapi import APIRouter, Depends

from src.core import enums
from src.services.auth import flows as auth_flows

from . import service

router = APIRouter(
    prefix="/challonge",
    tags=[enums.RouteTag.CHALLONGE],
    dependencies=[Depends(auth_flows.current_user)],
)


@router.get(path="/tournament")
async def get_tournament_from_challonge(tournament_slug: str):
    return await service.fetch_tournament(tournament_slug)


@router.get(path="/participants")
async def get_participants_from_challonge(tournament_id: int):
    return await service.fetch_participants(tournament_id)


@router.get(path="/matches")
async def get_matches_from_challonge(tournament_id: int):
    return await service.fetch_matches(tournament_id)
