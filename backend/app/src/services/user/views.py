import typing

from cashews import cache
from cashews.contrib.fastapi import cache_control_ttl
from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.requests import Request

from src import schemas
from src.core import config, db, enums, pagination
from src.services.encounter import flows as encounter_flows
from src.services.map import flows as map_flows

from . import flows
from ...core.clerk import get_current_user

router = APIRouter(prefix="/users", tags=[enums.RouteTag.USER])


@router.get(
    path="",
    response_model=pagination.Paginated[schemas.UserRead],
    description="Retrieve a list of users based on search parameters. "
    "Available entities: **discord, battle_tag, twitch.**",
    summary="Search for users",
)
async def get_all(
    params: pagination.PaginationSortSearchQueryParams[
        typing.Literal["id", "name", "similarity:name"]
    ] = Depends(),
    session=Depends(db.get_async_session),
):
    return await flows.get_all(
        session, pagination.PaginationSortSearchParams.from_query_params(params)
    )


@router.get(
    path="/{name}",
    response_model=schemas.UserRead,
    description="Search for a given player by using its username or BattleTag (with # replaced by -). "
    "If you don't find the player by using the name, please try with the BattleTag. "
    "You should be able to find the associated player_id to use in order to request career data. "
    "Available entities: **discord, battle_tag, twitch.**"
    f"**Cache TTL: {config.settings.users_cache_ttl / 60} minutes.**",
    summary="Get user by name",
)
@cache(
    ttl=cache_control_ttl(default=config.settings.users_cache_ttl),
    key="fastapi:{request.url.path}/{request.query_params}",
)
async def get_by_name(
    request: Request,
    name: str,
    session: AsyncSession = Depends(db.get_async_session),
    entities: list[str] = Query([]),
):
    name = name.replace("-", "#")
    user = await flows.get_by_battle_tag(session, name, entities)
    return user


@router.get(
    path="/{id}/profile",
    response_model=schemas.UserProfile,
    description=f"Retrieve the profile information of a user by ID. **Cache TTL: {config.settings.users_cache_ttl / 60} minutes.**",
    summary="Get user profile",
)
@cache(
    ttl=cache_control_ttl(default=config.settings.users_cache_ttl),
    key="fastapi:{request.url.path}",
)
async def get_profile(request: Request, id: int, session=Depends(db.get_async_session)):
    profile = await flows.get_profile(session, id)
    return profile


@router.get(
    path="/{id}/tournaments",
    response_model=list[schemas.UserTournament],
    description=f"Retrieve the list of tournaments associated with a user by ID. **Cache TTL: {config.settings.users_cache_ttl / 60} minutes.**",
    summary="Get user tournaments",
)
@cache(
    ttl=cache_control_ttl(default=config.settings.tournaments_cache_ttl),
    key="fastapi:{request.url.path}",
)
async def get_tournaments(
    request: Request, id: int, session: AsyncSession = Depends(db.get_async_session)
):
    tournaments = await flows.get_tournaments(session, id)
    return tournaments


@router.get(
    path="/{id}/tournaments/{tournament_id}",
    response_model=schemas.UserTournamentWithStats,
    description=f"Retrieve detailed statistics for a specific tournament associated with a user. **Cache TTL: {config.settings.users_cache_ttl / 60} minutes.**",
    summary="Get user tournament details",
)
@cache(
    ttl=cache_control_ttl(default=config.settings.tournaments_cache_ttl),
    key="fastapi:{request.url.path}",
)
async def get_tournament(
    request: Request,
    id: int,
    tournament_id: int,
    session: AsyncSession = Depends(db.get_async_session),
):
    tournament = await flows.get_tournament_with_stats(session, id, tournament_id)
    return tournament


@router.get(
    path="/{id}/maps",
    response_model=pagination.Paginated[schemas.UserMap],
    description=f"Retrieve the most played maps for a user by ID, with pagination. **Cache TTL: {config.settings.users_cache_ttl / 60} minutes.**",
    summary="Get user maps",
)
@cache(
    ttl=cache_control_ttl(default=config.settings.maps_cache_ttl),
    key="fastapi:{request.url.path}/{request.query_params}",
)
async def get_maps(
    request: Request,
    id: int,
    session: AsyncSession = Depends(db.get_async_session),
    params: pagination.PaginationSortQueryParams[
        typing.Literal[
            "id",
            "count",
            "win",
            "loss",
            "draw",
            "winrate",
            "gamemode_id",
            "slug",
            "name",
        ]
    ] = Depends(),
):
    maps = await map_flows.get_top_user(
        session, id, pagination.PaginationSortParams.from_query_params(params)
    )
    return maps


@router.get(
    path="/{id}/encounters",
    response_model=pagination.Paginated[schemas.EncounterReadWithUserStats],
    description=f"Retrieve the encounters data for a user by ID, with pagination. **Cache TTL: {config.settings.users_cache_ttl / 60} minutes.**",
    summary="Get user encounters",
)
@cache(
    ttl=cache_control_ttl(default=config.settings.encounters_cache_ttl),
    key="fastapi:{request.url.path}/{request.query_params}",
)
async def get_encounters(
    request: Request,
    id: int,
    session: AsyncSession = Depends(db.get_async_session),
    params: pagination.PaginationSortQueryParams[
        typing.Literal[
            "id", "name", "home_team_id", "away_team_id", "closeness", "round"
        ]
    ] = Depends(),
):
    encounters = await encounter_flows.get_encounters_by_user(
        session, id, pagination.PaginationSortParams.from_query_params(params)
    )
    return encounters


@router.get(
    path="/{id}/heroes",
    response_model=pagination.Paginated[schemas.HeroWithUserStats],
    description="Retrieve the list of heroes associated with a user by ID, along with their stats."
    f"**Cache TTL: {config.settings.users_cache_ttl / 60} minutes.**",
    summary="Get user heroes",
)
@cache(
    ttl=cache_control_ttl(default=config.settings.heroes_cache_ttl),
    key="fastapi:{request.url.path}:{request.query_params}",
)
async def get_heroes(
    request: Request,
    id: int,
    params: pagination.PaginationQueryParams = Depends(),
    session: AsyncSession = Depends(db.get_async_session),
):
    heroes = await flows.get_heroes(
        session, id, pagination.PaginationParams.from_query_params(params)
    )
    return heroes


@router.get(
    path="/{id}/teammates",
    response_model=pagination.Paginated[schemas.UserBestTeammate],
    description=f"Retrieve the list of teammates associated with a user by ID. **Cache TTL: {config.settings.users_cache_ttl / 60} minutes.**",
    summary="Get user best teammates",
)
@cache(
    ttl=cache_control_ttl(default=config.settings.teams_cache_ttl),
    key="fastapi:{request.url.path}/{request.query_params}",
)
async def get_teammates(
    request: Request,
    id: int,
    params: pagination.PaginationSortQueryParams[
        typing.Literal["id", "name", "winrate", "tournaments"]
    ] = Depends(),
    session: AsyncSession = Depends(db.get_async_session),
):
    teammates = await flows.get_best_teammates(
        session, id, pagination.PaginationSortParams.from_query_params(params)
    )
    return teammates


@router.get("/test/protected")
def private_data(user=Depends(get_current_user)):
    return {"message": "This is protected content", "user": user}
