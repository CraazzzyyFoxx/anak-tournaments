"""Admin service layer for gamemode CRUD operations"""

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src import models
from src.schemas.admin import gamemode as admin_schemas
from src.schemas import GamemodeRead

async def get_gamemodes(
    session: AsyncSession, page: int = 1, per_page: int = 50, search: str | None = None
) -> dict:
    """Get paginated list of gamemodes"""

    query = select(models.Gamemode)

    # Apply search filter
    if search:
        query = query.where(models.Gamemode.name.ilike(f"%{search}%"))

    # Count total
    count_query = select(models.Gamemode.id)
    if search:
        count_query = count_query.where(models.Gamemode.name.ilike(f"%{search}%"))
    total_result = await session.execute(count_query)
    total = len(total_result.all())

    # Apply pagination
    offset = (page - 1) * per_page
    query = query.offset(offset).limit(per_page)

    result = await session.execute(query)
    gamemodes = result.scalars().all()

    return {
        "results": [GamemodeRead.model_validate(gamemode, from_attributes=True) for gamemode in gamemodes],
        "total": total,
        "page": page,
        "per_page": per_page,
    }


async def create_gamemode(
    session: AsyncSession, data: admin_schemas.GamemodeCreate
) -> models.Gamemode:
    """Create a new gamemode"""
    # Check if gamemode with this name already exists
    result = await session.execute(
        select(models.Gamemode).where(models.Gamemode.name == data.name)
    )
    existing_gamemode = result.scalar_one_or_none()

    if existing_gamemode:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Gamemode with name '{data.name}' already exists",
        )

    # Create gamemode
    gamemode = models.Gamemode(name=data.name)

    session.add(gamemode)
    await session.commit()
    await session.refresh(gamemode)

    return gamemode


async def update_gamemode(
    session: AsyncSession, gamemode_id: int, data: admin_schemas.GamemodeUpdate
) -> models.Gamemode:
    """Update gamemode fields"""
    result = await session.execute(
        select(models.Gamemode).where(models.Gamemode.id == gamemode_id)
    )
    gamemode = result.scalar_one_or_none()

    if not gamemode:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Gamemode not found")

    # Check if new name conflicts with existing gamemode
    if data.name and data.name != gamemode.name:
        result = await session.execute(
            select(models.Gamemode).where(models.Gamemode.name == data.name)
        )
        existing_gamemode = result.scalar_one_or_none()

        if existing_gamemode:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Gamemode with name '{data.name}' already exists",
            )

    # Update fields
    update_data = data.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(gamemode, field, value)

    await session.commit()
    await session.refresh(gamemode)

    return gamemode


async def delete_gamemode(session: AsyncSession, gamemode_id: int) -> None:
    """Delete gamemode"""
    result = await session.execute(
        select(models.Gamemode).where(models.Gamemode.id == gamemode_id)
    )
    gamemode = result.scalar_one_or_none()

    if not gamemode:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Gamemode not found")

    await session.delete(gamemode)
    await session.commit()
