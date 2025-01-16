from fastapi import APIRouter, Depends

from src import schemas
from src.core import db, enums, pagination

from . import flows

router = APIRouter(prefix="/statistics", tags=[enums.RouteTag.STATISTICS])


@router.get(
    path="/champion",
    response_model=pagination.Paginated[schemas.PlayerStatistics],
    description="Retrieve a paginated list of players based on champion statistics. Supports sorting. ",
    summary="Get champion statistics",
)
async def get_most_champions(
    params: pagination.PaginationQueryParams = Depends(),
    session=Depends(db.get_async_session),
):
    return await flows.get_most_champions(
        session, pagination.PaginationParams.from_query_params(params)
    )


@router.get(
    path="/winrate",
    response_model=pagination.Paginated[schemas.PlayerStatistics],
    description="Retrieve a paginated list of players based on win rate statistics. Supports sorting. ",
    summary="Get win rate statistics",
)
async def get_player_winrate(
    params: pagination.PaginationQueryParams = Depends(),
    session=Depends(db.get_async_session),
):
    return await flows.get_to_winrate_players(
        session, pagination.PaginationParams.from_query_params(params)
    )


@router.get(
    path="/won-maps",
    response_model=pagination.Paginated[schemas.PlayerStatistics],
    description="Retrieve a paginated list of players based on won maps statistics. Supports sorting. ",
    summary="Get won maps statistics",
)
async def get_top_won_maps_players(
    params: pagination.PaginationQueryParams = Depends(),
    session=Depends(db.get_async_session),
):
    return await flows.get_to_won_players(
        session, pagination.PaginationParams.from_query_params(params)
    )
