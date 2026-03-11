"""Admin service layer for hero CRUD operations"""

import re

import sqlalchemy as sa
from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src import models
from src.schemas import HeroRead
from src.schemas.admin import hero as admin_schemas


def _slugify_name(name: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", name.strip().lower()).strip("-")
    return slug or "hero"


async def get_heroes(session: AsyncSession, params: admin_schemas.HeroListParams) -> dict:
    """Get paginated list of heroes"""
    query = select(models.Hero)
    count_query = select(sa.func.count(models.Hero.id))

    if params.search:
        search_term = f"%{params.search}%"
        query = query.where(models.Hero.name.ilike(search_term))
        count_query = count_query.where(models.Hero.name.ilike(search_term))

    if params.role:
        query = query.where(models.Hero.type == params.role)
        count_query = count_query.where(models.Hero.type == params.role)

    query = params.apply_pagination_sort(query, models.Hero)

    result = await session.execute(query)
    total_result = await session.execute(count_query)
    heroes = result.scalars().all()
    total = total_result.scalar_one()

    return {
        "results": [HeroRead.model_validate(hero, from_attributes=True) for hero in heroes],
        "total": total,
        "page": params.page,
        "per_page": params.per_page,
    }


async def create_hero(session: AsyncSession, data: admin_schemas.HeroCreate) -> models.Hero:
    """Create a new hero"""
    result = await session.execute(select(models.Hero).where(models.Hero.name == data.name))
    existing_hero = result.scalar_one_or_none()

    if existing_hero:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Hero with name '{data.name}' already exists",
        )

    hero = models.Hero(
        slug=_slugify_name(data.name),
        name=data.name,
        image_path=data.image_path or "",
        type=data.role,
        color=data.color,
    )

    session.add(hero)
    await session.commit()
    await session.refresh(hero)

    return hero


async def update_hero(session: AsyncSession, hero_id: int, data: admin_schemas.HeroUpdate) -> models.Hero:
    """Update hero fields"""
    result = await session.execute(select(models.Hero).where(models.Hero.id == hero_id))
    hero = result.scalar_one_or_none()

    if not hero:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Hero not found")

    if data.name and data.name != hero.name:
        result = await session.execute(select(models.Hero).where(models.Hero.name == data.name))
        existing_hero = result.scalar_one_or_none()

        if existing_hero:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Hero with name '{data.name}' already exists",
            )

    update_data = data.model_dump(exclude_unset=True)
    role = update_data.pop("role", None)
    if role is not None:
        hero.type = role

    for field_name, value in update_data.items():
        setattr(hero, field_name, value)

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
