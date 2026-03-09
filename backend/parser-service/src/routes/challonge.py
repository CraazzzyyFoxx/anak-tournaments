from fastapi import APIRouter, Depends

from src.core import enums, auth

from src.services.challonge import service as challonge_service

router = APIRouter(
    prefix="/challonge",
    tags=[enums.RouteTag.CHALLONGE],
    dependencies=[Depends(auth.require_role("admin"))]
)


@router.get(path="/tournament")
async def get_tournament_from_challonge(tournament_slug: str):
    return await challonge_service.fetch_tournament(tournament_slug)


@router.get(path="/participants")
async def get_participants_from_challonge(tournament_id: int):
    return await challonge_service.fetch_participants(tournament_id)


@router.get(path="/matches")
async def get_matches_from_challonge(tournament_id: int):
    return await challonge_service.fetch_matches(tournament_id)
