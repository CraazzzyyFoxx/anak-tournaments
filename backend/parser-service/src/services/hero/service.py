"""Hero domain reads; catalog sync belongs to the discipline module."""

from __future__ import annotations

import typing

from sqlalchemy.ext.asyncio import AsyncSession

from shared.repository import HeroRepository
from src import models
from src.core import errors, pagination

__all__ = ("HeroService", "hero_service", "get_all")


class HeroService:
    def __init__(self, *, repo: HeroRepository = HeroRepository()) -> None:
        self.repo = repo

    async def get_by_slugs(self, session: AsyncSession, slugs: list[str]) -> dict[str, models.Hero]:
        """Heroes among ``slugs``, keyed by slug, in one query."""
        return await self.repo.get_many_by(session, models.Hero.slug, slugs)

    async def get_by_slug(self, session: AsyncSession, slug: str) -> models.Hero:
        hero = await self.repo.get_by(session, slug=slug)
        if not hero:
            raise errors.ApiHTTPException(
                status_code=404,
                detail=[errors.ApiExc(code="not_found", msg=f"Hero with slug {slug} not found")],
            )
        return hero

    async def get_by_name(self, session: AsyncSession, name: str) -> models.Hero:
        hero = await self.repo.get_by_name(session, name)
        if not hero:
            raise errors.ApiHTTPException(
                status_code=404,
                detail=[errors.ApiExc(code="not_found", msg=f"Hero with name {name} not found")],
            )
        return hero

    async def get_all(
        self, session: AsyncSession, params: pagination.PaginationSortParams
    ) -> tuple[typing.Sequence[models.Hero], int]:
        return await self.repo.get_all(session, params)


hero_service = HeroService()

# `services/match_logs/flows.py` (a different work package's file set) imports
# this module and calls `hero_service.get_all(...)` directly — kept resolvable
# as a module-level attribute rather than only on the class, per the
# compat-binding rule in
# `docs/plans/2026-08-21-parser-service-oop-repositories.md`.
get_all = hero_service.get_all
