import typing

from cashews import cache
from cashews.contrib.fastapi import cache_control_ttl
from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.requests import Request

from src import schemas
from src.core import config, db, enums, pagination
from src.services.hero import flows as hero_flows

router = APIRouter(prefix="/heroes", tags=[enums.RouteTag.HERO])


@router.get(
    path="/{id}",
    response_model=schemas.HeroRead,
    description=f"Retrieve details of a specific hero by its ID. **Cache TTL:** {config.settings.heroes_cache_ttl} minutes.",
    summary="Get hero by ID",
)
async def get_hero(
    id: int,
    session: AsyncSession = Depends(db.get_async_session),
):
    return await hero_flows.get(session, id)


@router.get(
    path="",
    response_model=pagination.Paginated[schemas.HeroRead],
    description="Retrieve a paginated list of heroes. Supports search and filtering.",
    summary="Get all heroes",
)
async def get_all_heroes(
    request: Request,
    params: pagination.PaginationSortSearchQueryParams[
        typing.Literal["id", "name", "slug", "similarity:name", "similarity:slug"]
    ] = Depends(),
    session: AsyncSession = Depends(db.get_async_session),
):
    return await hero_flows.get_all(
        session, pagination.PaginationSortSearchParams.from_query_params(params)
    )


@router.get(
    path="/statistics/playtime",
    response_model=pagination.Paginated[schemas.HeroPlaytime],
    description=f"Retrieve playtime statistics for heroes associated with a specific user. Supports pagination and sorting. **Cache TTL:** {config.settings.heroes_cache_ttl} minutes.",
    summary="Get hero playtime statistics",
)
@cache(
    ttl=cache_control_ttl(default=config.settings.encounters_cache_ttl),
    key="fastapi:{request.url.path}/{request.query_params}",
)
async def get_statistics(
    request: Request,
    params: schemas.HeroPlaytimeQueryPaginationParams = Depends(),
    session: AsyncSession = Depends(db.get_async_session),
):
    return await hero_flows.get_playtime(
        session, schemas.HeroPlaytimePaginationParams.from_query_params(params)
    )


@router.get(
    path="/{hero_id}/leaderboard",
    response_model=pagination.Paginated[schemas.HeroLeaderboardEntry],
    description=f"Retrieve leaderboard of players ranked by their performance on a specific hero. Optionally filter by tournament. **Cache TTL:** {config.settings.heroes_cache_ttl} minutes.",
    summary="Get hero performance leaderboard",
)
@cache(
    ttl=cache_control_ttl(default=config.settings.heroes_cache_ttl),
    key="fastapi:{request.url.path}/{request.query_params}",
)
async def get_hero_leaderboard(
    request: Request,
    hero_id: int,
    params: schemas.HeroLeaderboardQueryParams = Depends(),
    session: AsyncSession = Depends(db.get_async_session),
):
    return await hero_flows.get_hero_leaderboard(
        session,
        hero_id=hero_id,
        params=schemas.HeroLeaderboardParams.from_query_params(params),
    )
