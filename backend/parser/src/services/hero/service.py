import typing

import sqlalchemy as sa

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import Session

from src import models
from src.core import pagination, enums


async def get_by_slug(session: AsyncSession, slug: str) -> models.Hero | None:
    query = sa.select(
        models.Hero,
    ).where(sa.and_(models.Hero.slug == slug))
    result = await session.execute(query)
    return result.scalar_one_or_none()


def get_by_name(session: Session, name: str) -> models.Hero | None:
    query = sa.select(
        models.Hero,
    ).where(sa.and_(models.Hero.name == name))
    result = session.execute(query)
    return result.scalar_one_or_none()


async def get_all(
    session: AsyncSession,
    params: pagination.PaginationParams,
) -> tuple[typing.Sequence[models.Hero], int]:
    query = sa.select(models.Hero)
    query = params.apply_pagination_sort(query, models.Hero)
    result = await session.execute(query)
    total_query = sa.select(sa.func.count(models.Hero.id))
    total_result = await session.execute(total_query)
    return result.scalars().all(), total_result.scalar_one()


async def create(
    session: AsyncSession,
    *,
    slug: str,
    name: str,
    image_path: str,
    type: enums.HeroClass,
) -> models.Hero:
    hero = models.Hero(
        slug=slug,
        name=name,
        image_path=image_path,
        type=type,
    )
    session.add(hero)
    await session.commit()
    return hero
