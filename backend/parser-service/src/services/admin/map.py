"""Admin service layer for map CRUD operations"""

import sqlalchemy as sa
from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from src import models
from src.schemas import MapRead
from src.schemas.admin import map as admin_schemas


async def get_maps(session: AsyncSession, params: admin_schemas.MapListParams) -> dict:
    """Get paginated list of maps"""
    query = select(models.Map).options(selectinload(models.Map.gamemode))
    count_query = select(sa.func.count(models.Map.id))

    if params.search:
        search_term = f"%{params.search}%"
        query = query.where(models.Map.name.ilike(search_term))
        count_query = count_query.where(models.Map.name.ilike(search_term))

    if params.gamemode_id is not None:
        query = query.where(models.Map.gamemode_id == params.gamemode_id)
        count_query = count_query.where(models.Map.gamemode_id == params.gamemode_id)

    query = params.apply_pagination_sort(query, models.Map)

    result = await session.execute(query)
    total_result = await session.execute(count_query)
    maps = result.scalars().all()
    total = total_result.scalar_one()

    return {
        "results": [MapRead.model_validate(map_obj, from_attributes=True) for map_obj in maps],
        "total": total,
        "page": params.page,
        "per_page": params.per_page,
    }


async def create_map(session: AsyncSession, data: admin_schemas.MapCreate) -> models.Map:
    """Create a new map"""
    gamemode_result = await session.execute(select(models.Gamemode).where(models.Gamemode.id == data.gamemode_id))
    gamemode = gamemode_result.scalar_one_or_none()

    if not gamemode:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Gamemode not found")

    result = await session.execute(select(models.Map).where(models.Map.name == data.name))
    existing_map = result.scalar_one_or_none()

    if existing_map:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Map with name '{data.name}' already exists",
        )

    map_obj = models.Map(name=data.name, gamemode_id=data.gamemode_id)

    session.add(map_obj)
    await session.commit()
    await session.refresh(map_obj, ["gamemode"])

    return map_obj


async def update_map(session: AsyncSession, map_id: int, data: admin_schemas.MapUpdate) -> models.Map:
    """Update map fields"""
    result = await session.execute(
        select(models.Map).where(models.Map.id == map_id).options(selectinload(models.Map.gamemode))
    )
    map_obj = result.scalar_one_or_none()

    if not map_obj:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Map not found")

    if data.gamemode_id:
        gamemode_result = await session.execute(select(models.Gamemode).where(models.Gamemode.id == data.gamemode_id))
        gamemode = gamemode_result.scalar_one_or_none()

        if not gamemode:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Gamemode not found",
            )

    if data.name and data.name != map_obj.name:
        result = await session.execute(select(models.Map).where(models.Map.name == data.name))
        existing_map = result.scalar_one_or_none()

        if existing_map:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Map with name '{data.name}' already exists",
            )

    update_data = data.model_dump(exclude_unset=True)
    for field_name, value in update_data.items():
        setattr(map_obj, field_name, value)

    await session.commit()
    await session.refresh(map_obj, ["gamemode"])

    return map_obj


async def delete_map(session: AsyncSession, map_id: int) -> None:
    """Delete map"""
    result = await session.execute(select(models.Map).where(models.Map.id == map_id))
    map_obj = result.scalar_one_or_none()

    if not map_obj:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Map not found")

    await session.delete(map_obj)
    await session.commit()
