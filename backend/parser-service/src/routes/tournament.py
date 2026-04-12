from datetime import datetime, date

from fastapi import APIRouter, Depends, Query

from src import schemas
from src.core import db, enums, auth

from src.services.tournament import flows as tournament_flows

router = APIRouter(
    prefix="/tournament",
    tags=[enums.RouteTag.TOURNAMENT],
    dependencies=[Depends(auth.require_role("admin"))],
)


@router.post(path="/create", response_model=schemas.TournamentRead)
async def create(
    number: int,
    is_league: bool,
    start_date: date,
    end_date: date,
    playoffs_challonge_slug: str,
    groups_challonge_slugs: list[str] = Query([]),
    session=Depends(db.get_async_session),
):
    tournament = await tournament_flows.create(
        session, number, is_league, start_date, end_date, groups_challonge_slugs, playoffs_challonge_slug
    )
    return await tournament_flows.to_pydantic(session, tournament, [])


@router.post(path="/create/with_groups", response_model=schemas.TournamentRead)
async def create_with_groups(
    number: int,
    challonge_slug: str,
    is_league: bool,
    start_date: date,
    end_date: date,
    session=Depends(db.get_async_session),
):
    tournament = await tournament_flows.create_with_groups(
        session, number, is_league, start_date, end_date, challonge_slug
    )
    return await tournament_flows.to_pydantic(session, tournament, [])
