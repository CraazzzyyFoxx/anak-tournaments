"""Admin service layer for map CRUD operations"""

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from src import models
from src.schemas.admin import map as admin_schemas
from src.schemas import MapRead

async def get_maps(
    session: AsyncSession,
    page: int = 1,
    per_page: int = 50,
    search: str | None = None,
    gamemode_id: int | None = None,
) -> dict:
    """Get paginated list of maps"""
    query = select(models.Map).options(selectinload(models.Map.gamemode))

    # Apply search filter
    if search:
        query = query.where(models.Map.name.ilike(f"%{search}%"))

    # Apply gamemode filter
    if gamemode_id:
        query = query.where(models.Map.gamemode_id == gamemode_id)

    # Count total
    count_query = select(models.Map.id)
    if search:
        count_query = count_query.where(models.Map.name.ilike(f"%{search}%"))
    if gamemode_id:
        count_query = count_query.where(models.Map.gamemode_id == gamemode_id)
    total_result = await session.execute(count_query)
    total = len(total_result.all())

    # Apply pagination
    offset = (page - 1) * per_page
    query = query.offset(offset).limit(per_page)

    result = await session.execute(query)
    maps = result.scalars().all()

    return {
        "results": [MapRead.model_validate(map_obj, from_attributes=True) for map_obj in maps],
        "total": total,
        "page": page,
        "per_page": per_page,
    }


async def create_map(session: AsyncSession, data: admin_schemas.MapCreate) -> models.Map:
    """Create a new map"""
    # Verify gamemode exists
    gamemode_result = await session.execute(
        select(models.Gamemode).where(models.Gamemode.id == data.gamemode_id)
    )
    gamemode = gamemode_result.scalar_one_or_none()

    if not gamemode:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Gamemode not found")

    # Check if map with this name already exists
    result = await session.execute(select(models.Map).where(models.Map.name == data.name))
    existing_map = result.scalar_one_or_none()

    if existing_map:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Map with name '{data.name}' already exists",
        )

    # Create map
    map_obj = models.Map(name=data.name, gamemode_id=data.gamemode_id)

    session.add(map_obj)
    await session.commit()
    await session.refresh(map_obj, ["gamemode"])

    return map_obj


async def update_map(
    session: AsyncSession, map_id: int, data: admin_schemas.MapUpdate
) -> models.Map:
    """Update map fields"""
    result = await session.execute(
        select(models.Map)
        .where(models.Map.id == map_id)
        .options(selectinload(models.Map.gamemode))
    )
    map_obj = result.scalar_one_or_none()

    if not map_obj:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Map not found")

    # Verify gamemode exists if being updated
    if data.gamemode_id:
        gamemode_result = await session.execute(
            select(models.Gamemode).where(models.Gamemode.id == data.gamemode_id)
        )
        gamemode = gamemode_result.scalar_one_or_none()

        if not gamemode:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail="Gamemode not found"
            )

    # Check if new name conflicts with existing map
    if data.name and data.name != map_obj.name:
        result = await session.execute(select(models.Map).where(models.Map.name == data.name))
        existing_map = result.scalar_one_or_none()

        if existing_map:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Map with name '{data.name}' already exists",
            )

    # Update fields
    update_data = data.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(map_obj, field, value)

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
