from fastapi import APIRouter, Depends, Query

from src import schemas
from src.core import db, enums
from src.services.auth import flows as auth_flows

from . import flows

router = APIRouter(
    prefix="/tournament",
    tags=[enums.RouteTag.TOURNAMENT],
    dependencies=[Depends(auth_flows.current_user)],
)


@router.post(path="/create", response_model=schemas.TournamentRead)
async def create(
    number: int,
    is_league: bool,
    playoffs_challonge_slug: str,
    groups_challonge_slugs: list[str] = Query([]),
    session=Depends(db.get_async_session),
):
    tournament = await flows.create(
        session, number, is_league, groups_challonge_slugs, playoffs_challonge_slug
    )
    return await flows.to_pydantic(session, tournament, [])


@router.post(path="/create/with_groups")
async def create_with_groups(
    number: int,
    challonge_slug: str,
    session=Depends(db.get_async_session),
):
    return await flows.create_with_groups(session, number, challonge_slug)
