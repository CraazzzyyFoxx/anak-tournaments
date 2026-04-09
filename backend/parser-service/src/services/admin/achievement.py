"""Admin service layer for achievement CRUD operations"""

import sqlalchemy as sa
from fastapi import HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from shared.repository import BaseRepository

from src import models
from src.schemas.admin import achievement as admin_schemas

_repo = BaseRepository(models.Achievement)


async def get_achievements(
    session: AsyncSession, params: admin_schemas.AchievementListParams
) -> dict:
    """Get paginated list of achievements"""
    filters: list[sa.ColumnElement[bool]] = []
    if params.search:
        filters.append(
            sa.or_(
                models.Achievement.name.ilike(f"%{params.search}%"),
                models.Achievement.slug.ilike(f"%{params.search}%"),
            )
        )

    achievements, total = await _repo.get_all(session, params, filters=filters)

    return {
        "results": [
            admin_schemas.AchievementAdminRead.model_validate(a, from_attributes=True)
            for a in achievements
        ],
        "total": total,
        "page": params.page,
        "per_page": params.per_page,
    }


async def create_achievement(
    session: AsyncSession, data: admin_schemas.AchievementAdminCreate
) -> models.Achievement:
    """Create a new achievement"""
    existing = await _repo.get_by(session, slug=data.slug)
    if existing:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Achievement with slug '{data.slug}' already exists",
        )

    achievement = models.Achievement(
        name=data.name,
        slug=data.slug,
        description_ru=data.description_ru,
        description_en=data.description_en,
        image_url=data.image_url,
        hero_id=data.hero_id,
    )
    return await _repo.create(session, achievement)


async def update_achievement(
    session: AsyncSession, achievement_id: int, data: admin_schemas.AchievementAdminUpdate
) -> models.Achievement:
    """Update achievement fields"""
    achievement = await _repo.get(session, achievement_id)
    if not achievement:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Achievement not found"
        )

    if data.slug and data.slug != achievement.slug:
        existing = await _repo.get_by(session, slug=data.slug)
        if existing:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Achievement with slug '{data.slug}' already exists",
            )

    update_data = data.model_dump(exclude_unset=True)
    return await _repo.update(session, achievement, update_data)


async def delete_achievement(session: AsyncSession, achievement_id: int) -> None:
    """Delete achievement"""
    achievement = await _repo.get(session, achievement_id)
    if not achievement:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Achievement not found"
        )

    await _repo.delete(session, achievement)
