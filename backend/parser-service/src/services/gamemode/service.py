"""Gamemode domain: OverFast sync + CRUD reads.

Merges the former ``service.py`` (reads) and ``flows.py`` (OverFast sync
orchestration) into one class, per ``backend/ARCHITECTURE.md``'s "small
domains keep everything in one service.py" rule.
"""

from __future__ import annotations

import typing

from sqlalchemy.ext.asyncio import AsyncSession

from shared.repository import GamemodeRepository
from src import models, schemas
from src.clients.overfast import OverFastCatalogClient, overfast_catalog_client
from src.core import pagination

__all__ = ("GamemodeService", "gamemode_service")


class GamemodeService:
    def __init__(
        self,
        *,
        repo: GamemodeRepository = GamemodeRepository(),
        overfast: OverFastCatalogClient = overfast_catalog_client,
    ) -> None:
        self.repo = repo
        self.overfast = overfast

    async def get(self, session: AsyncSession, id: int) -> models.Gamemode | None:
        return await self.repo.get(session, id)

    async def get_existing_slugs(self, session: AsyncSession, slugs: list[str]) -> set[str]:
        """Slugs among ``slugs`` that already exist, in one query (batch
        counterpart of the per-item probe used by ``initial_create``)."""
        return set(await self.repo.get_many_by(session, models.Gamemode.slug, slugs))

    async def get_by_slug(self, session: AsyncSession, slug: str) -> models.Gamemode | None:
        return await self.repo.get_by(session, slug=slug)

    async def get_all(
        self, session: AsyncSession, params: pagination.PaginationSortParams
    ) -> tuple[typing.Sequence[models.Gamemode], int]:
        return await self.repo.get_all(session, params)

    async def fetch_gamemodes(self) -> list[schemas.OverfastGamemode]:
        return await self.overfast.fetch_gamemodes()

    async def initial_create(self, session: AsyncSession) -> None:
        gamemodes = await self.fetch_gamemodes()

        # One existence query + one bulk insert instead of a get-then-create pair
        # per gamemode.
        existing_slugs = await self.get_existing_slugs(session, [gamemode.key for gamemode in gamemodes])
        new_gamemodes: list[models.Gamemode] = []
        for gamemode in gamemodes:
            if gamemode.key in existing_slugs:
                continue
            existing_slugs.add(gamemode.key)
            new_gamemodes.append(
                models.Gamemode(
                    slug=gamemode.key,
                    name=gamemode.name,
                    image_path=gamemode.icon,
                    description=gamemode.description,
                )
            )

        if new_gamemodes:
            await self.repo.create_many(session, new_gamemodes)
            await session.commit()


gamemode_service = GamemodeService()
