import typing

from cashews import cache
from cashews.contrib.fastapi import cache_control_ttl
from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.requests import Request

from src import schemas
from src.core import config, db, enums, pagination

from . import flows

router = APIRouter(prefix="/achievements", tags=[enums.RouteTag.ACHIEVEMENTS])


@router.get(
    path="",
    response_model=pagination.Paginated[schemas.AchievementRead],
    description="Retrieve a paginated list of achievements. "
    "Supports search and filtering. "
    "Supports fetching additional related entities. "
    "Available entities: **hero**. ",
    summary="Get all achievements",
)
async def get_all(
    session: AsyncSession = Depends(db.get_async_session),
    params: pagination.PaginationSortQueryParams[
        typing.Literal[
            "id", "name", "slug", "rarity", "similarity:name", "similarity:slug"
        ]
    ] = Depends(),
):
    return await flows.get_all(
        session, pagination.PaginationSortParams.from_query_params(params)
    )


@router.get(
    path="/{id}",
    response_model=schemas.AchievementRead,
    description="Retrieve details of a specific achievement by its ID. "
    "Supports fetching additional related entities."
    "Available entities: **hero**. "
    f"Cache TTL: {config.settings.achievements_cache_ttl / 60} minutes.",
    summary="Get achievement by ID",
)
@cache(
    ttl=cache_control_ttl(default=config.settings.achievements_cache_ttl),
    key="fastapi:{request.url.path}/{request.query_params}",
)
async def get(
    request: Request,
    id: int,
    entities: list[str] = Query([]),
    session: AsyncSession = Depends(db.get_async_session),
):
    return await flows.get(session, id, entities)


@router.get(
    path="/{id}/users",
    response_model=pagination.Paginated[schemas.AchievementEarned],
    description="Retrieve all users who have earned a specific achievement by its ID. Supports pagination.",
    summary="Get users who earned an achievement",
)
async def get_users_achievement(
    id: int,
    params: pagination.PaginationQueryParams = Depends(),
    session: AsyncSession = Depends(db.get_async_session),
):
    return await flows.get_users_achievement(session, id, pagination.PaginationParams.from_query_params(params))



@router.get(
    path="/user/{user_id}",
    response_model=list[schemas.UserAchievementRead],
    description=""
    "Retrieve all achievements associated with a specific user by their user ID. "
    "Supports fetching additional related entities."
    "Available entities: **hero, tournaments**. "
    f"Cache TTL: {config.settings.achievements_cache_ttl / 60} minutes.",
    summary="Get user achievements",
)
@cache(
    ttl=cache_control_ttl(default=config.settings.achievements_cache_ttl),
    key="fastapi:{request.url.path}/{request.query_params}",
)
async def get_user_achievements(
    request: Request,
    user_id: int,
    entities: list[str] = Query([]),
    session: AsyncSession = Depends(db.get_async_session),
):
    return await flows.get_user_achievements(session, user_id, entities)
