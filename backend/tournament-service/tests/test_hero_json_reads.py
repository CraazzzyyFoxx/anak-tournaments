"""Catalog heroes projected into match-stat JSON still satisfy the HeroRead wire contract."""

import asyncio
from uuid import uuid4

import pytest
import sqlalchemy as sa
from sqlalchemy.ext.asyncio import AsyncSession

from src import models, schemas
from src.services.encounter.service import hero_jsonb_object


@pytest.mark.parametrize(("image_path", "expected"), [(None, ""), ("/ana.png", "/ana.png")])
def test_json_heroes_keep_a_string_image_path(db_session: AsyncSession, image_path: str | None, expected: str) -> None:
    async def _run() -> None:
        hero = models.CatalogEntity(
            discipline="overwatch",
            kind="character",
            slug=f"hero-json-{uuid4().hex}",
            name=f"Hero JSON {uuid4().hex}",
            image_path=image_path,
            attrs={"class": "support"},
        )
        try:
            db_session.add(hero)
            await db_session.flush()
            payload = await db_session.scalar(
                sa.select(hero_jsonb_object).where(
                    models.CatalogEntity.id == hero.id,
                    models.CatalogEntity.kind == "character",
                    models.CatalogEntity.discipline == "overwatch",
                )
            )
            read = schemas.HeroRead.model_validate(payload)
            assert (read.id, read.image_path) == (hero.id, expected)
        finally:
            await db_session.rollback()

    asyncio.run(_run())
