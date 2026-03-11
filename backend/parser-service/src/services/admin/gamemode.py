"""Admin service layer for gamemode CRUD operations"""

import sqlalchemy as sa
from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src import models
from src.schemas import GamemodeRead
from src.schemas.admin import gamemode as admin_schemas


async def get_gamemodes(session: AsyncSession, params: admin_schemas.GamemodeListParams) -> dict:
    """Get paginated list of gamemodes"""
    query = select(models.Gamemode)
    count_query = select(sa.func.count(models.Gamemode.id))

    if params.search:
        search_term = f"%{params.search}%"
        query = query.where(models.Gamemode.name.ilike(search_term))
        count_query = count_query.where(models.Gamemode.name.ilike(search_term))

    query = params.apply_pagination_sort(query, models.Gamemode)

    result = await session.execute(query)
    total_result = await session.execute(count_query)
    gamemodes = result.scalars().all()
    total = total_result.scalar_one()

    return {
        "results": [GamemodeRead.model_validate(gamemode, from_attributes=True) for gamemode in gamemodes],
        "total": total,
        "page": params.page,
        "per_page": params.per_page,
    }


async def create_gamemode(session: AsyncSession, data: admin_schemas.GamemodeCreate) -> models.Gamemode:
    """Create a new gamemode"""
    result = await session.execute(select(models.Gamemode).where(models.Gamemode.name == data.name))
    existing_gamemode = result.scalar_one_or_none()

    if existing_gamemode:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Gamemode with name '{data.name}' already exists",
        )

    gamemode = models.Gamemode(name=data.name)

    session.add(gamemode)
    await session.commit()
    await session.refresh(gamemode)

    return gamemode


async def update_gamemode(
    session: AsyncSession, gamemode_id: int, data: admin_schemas.GamemodeUpdate
) -> models.Gamemode:
    """Update gamemode fields"""
    result = await session.execute(select(models.Gamemode).where(models.Gamemode.id == gamemode_id))
    gamemode = result.scalar_one_or_none()

    if not gamemode:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Gamemode not found")

    if data.name and data.name != gamemode.name:
        result = await session.execute(select(models.Gamemode).where(models.Gamemode.name == data.name))
        existing_gamemode = result.scalar_one_or_none()

        if existing_gamemode:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Gamemode with name '{data.name}' already exists",
            )

    update_data = data.model_dump(exclude_unset=True)
    for field_name, value in update_data.items():
        setattr(gamemode, field_name, value)

    await session.commit()
    await session.refresh(gamemode)

    return gamemode


async def delete_gamemode(session: AsyncSession, gamemode_id: int) -> None:
    """Delete gamemode"""
    result = await session.execute(select(models.Gamemode).where(models.Gamemode.id == gamemode_id))
    gamemode = result.scalar_one_or_none()

    if not gamemode:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Gamemode not found")

    await session.delete(gamemode)
    await session.commit()
