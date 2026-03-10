"""Admin service layer for hero CRUD operations"""

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src import models
from src.core import pagination
from src.schemas import HeroRead
from src.schemas.admin import hero as admin_schemas


async def get_heroes(
    session: AsyncSession, page: int = 1, per_page: int = 50, search: str | None = None,
    role: str | None = None
) -> dict:
    """Get paginated list of heroes"""
    query = select(models.Hero)

    # Apply search filter
    if search:
        query = query.where(models.Hero.name.ilike(f"%{search}%"))

    # Apply role filter
    if role:
        query = query.where(models.Hero.role == role)

    # Count total
    count_query = select(models.Hero.id)
    if search:
        count_query = count_query.where(models.Hero.name.ilike(f"%{search}%"))
    if role:
        count_query = count_query.where(models.Hero.role == role)
    total_result = await session.execute(count_query)
    total = len(total_result.all())

    # Apply pagination
    offset = (page - 1) * per_page
    query = query.offset(offset).limit(per_page)

    result = await session.execute(query)
    heroes = result.scalars().all()

    return {
        "results": [HeroRead.model_validate(hero, from_attributes=True) for hero in heroes],
        "total": total,
        "page": page,
        "per_page": per_page,
    }


async def create_hero(session: AsyncSession, data: admin_schemas.HeroCreate) -> models.Hero:
    """Create a new hero"""
    # Check if hero with this name already exists
    result = await session.execute(select(models.Hero).where(models.Hero.name == data.name))
    existing_hero = result.scalar_one_or_none()

    if existing_hero:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Hero with name '{data.name}' already exists",
        )

    # Create hero
    hero = models.Hero(name=data.name, role=data.role, color=data.color)

    session.add(hero)
    await session.commit()
    await session.refresh(hero)

    return hero


async def update_hero(
    session: AsyncSession, hero_id: int, data: admin_schemas.HeroUpdate
) -> models.Hero:
    """Update hero fields"""
    result = await session.execute(select(models.Hero).where(models.Hero.id == hero_id))
    hero = result.scalar_one_or_none()

    if not hero:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Hero not found")

    # Check if new name conflicts with existing hero
    if data.name and data.name != hero.name:
        result = await session.execute(select(models.Hero).where(models.Hero.name == data.name))
        existing_hero = result.scalar_one_or_none()

        if existing_hero:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Hero with name '{data.name}' already exists",
            )

    # Update fields
    update_data = data.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(hero, field, value)

    await session.commit()
    await session.refresh(hero)

    return hero


async def delete_hero(session: AsyncSession, hero_id: int) -> None:
    """Delete hero"""
    result = await session.execute(select(models.Hero).where(models.Hero.id == hero_id))
    hero = result.scalar_one_or_none()

    if not hero:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Hero not found")

    await session.delete(hero)
    await session.commit()
