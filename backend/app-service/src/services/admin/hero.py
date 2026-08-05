"""Admin service layer for hero CRUD operations"""

import re

import sqlalchemy as sa
from sqlalchemy.ext.asyncio import AsyncSession

from shared.catalog_aliases import normalize_aliases
from shared.core import http_status as status
from shared.core.errors import BaseAPIException as HTTPException
from shared.repository import HeroRepository
from src import models
from src.schemas import HeroRead
from src.schemas.admin import hero as admin_schemas

_repo = HeroRepository()


def _slugify_name(name: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", name.strip().lower()).strip("-")
    return slug or "hero"


async def get_heroes(session: AsyncSession, params: admin_schemas.HeroListParams) -> dict:
    """Get paginated list of heroes"""
    filters: list[sa.ColumnElement[bool]] = []
    if params.search:
        filters.append(models.Hero.name.ilike(f"%{params.search}%"))
    if params.role:
        filters.append(models.Hero.type == params.role)

    heroes, total = await _repo.get_all(session, params, filters=filters)

    return {
        "results": [HeroRead.model_validate(hero, from_attributes=True) for hero in heroes],
        "total": total,
        "page": params.page,
        "per_page": params.per_page,
    }


async def create_hero(session: AsyncSession, data: admin_schemas.HeroCreate) -> models.Hero:
    """Create a new hero"""
    existing = await _repo.get_by(session, name=data.name)
    if existing:
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
        aliases=normalize_aliases(data.aliases or [], canonical=data.name),
    )
    hero = await _repo.create(session, hero)
    await session.commit()
    await session.refresh(hero)
    return hero


async def update_hero(session: AsyncSession, hero_id: int, data: admin_schemas.HeroUpdate) -> models.Hero:
    """Update hero fields"""
    hero = await _repo.get(session, hero_id)
    if not hero:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Hero not found")

    if data.name and data.name != hero.name:
        existing = await _repo.get_by(session, name=data.name)
        if existing:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Hero with name '{data.name}' already exists",
            )

    update_data = data.model_dump(exclude_unset=True)
    role = update_data.pop("role", None)
    if role is not None:
        update_data["type"] = role
    if "aliases" in update_data:
        update_data["aliases"] = normalize_aliases(
            update_data["aliases"] or [], canonical=update_data.get("name") or hero.name
        )

    hero = await _repo.update_fields(session, hero, update_data)
    await session.commit()
    await session.refresh(hero)
    return hero


async def delete_hero(session: AsyncSession, hero_id: int) -> None:
    """Delete hero"""
    hero = await _repo.get(session, hero_id)
    if not hero:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Hero not found")

    await _repo.delete(session, hero)
    await session.commit()
