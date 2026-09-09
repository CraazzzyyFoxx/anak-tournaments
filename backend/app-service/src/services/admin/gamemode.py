"""Admin service layer for gamemode CRUD operations"""

from __future__ import annotations

import sqlalchemy as sa
from sqlalchemy.ext.asyncio import AsyncSession

from shared.catalog_aliases import normalize_aliases
from shared.core import http_status as status
from shared.core.errors import BaseAPIException as HTTPException
from shared.core.pagination import paginated_dict
from shared.repository import GamemodeRepository
from src import models, schemas
from src.schemas import GamemodeRead

__all__ = ("GamemodeAdminService", "gamemodes", "normalize_aliases")


class GamemodeAdminService:
    def __init__(self, *, repo: GamemodeRepository = GamemodeRepository()) -> None:
        self.repo = repo

    async def get_gamemodes(self, session: AsyncSession, params: schemas.GamemodeListParams) -> dict:
        """Get paginated list of gamemodes"""
        filters: list[sa.ColumnElement[bool]] = []
        if params.search:
            filters.append(models.Gamemode.name.ilike(f"%{params.search}%"))

        gamemodes_page, total = await self.repo.get_all(session, params, filters=filters)

        return paginated_dict(
            [GamemodeRead.model_validate(gm, from_attributes=True) for gm in gamemodes_page],
            total,
            params,
        )

    async def create_gamemode(self, session: AsyncSession, data: schemas.GamemodeCreate) -> models.Gamemode:
        """Create a new gamemode"""
        existing = await self.repo.get_by(session, name=data.name)
        if existing:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Gamemode with name '{data.name}' already exists",
            )

        gamemode = models.Gamemode(name=data.name, aliases=normalize_aliases(data.aliases or [], canonical=data.name))
        gamemode = await self.repo.create(session, gamemode)
        await session.commit()
        await session.refresh(gamemode)
        return gamemode

    async def update_gamemode(
        self, session: AsyncSession, gamemode_id: int, data: schemas.GamemodeUpdate
    ) -> models.Gamemode:
        """Update gamemode fields"""
        gamemode = await self.repo.get(session, gamemode_id)
        if not gamemode:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Gamemode not found")

        if data.name and data.name != gamemode.name:
            existing = await self.repo.get_by(session, name=data.name)
            if existing:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"Gamemode with name '{data.name}' already exists",
                )

        update_data = data.model_dump(exclude_unset=True)
        if "aliases" in update_data:
            update_data["aliases"] = normalize_aliases(
                update_data["aliases"] or [], canonical=update_data.get("name") or gamemode.name
            )
        gamemode = await self.repo.update_fields(session, gamemode, update_data)
        await session.commit()
        await session.refresh(gamemode)
        return gamemode

    async def delete_gamemode(self, session: AsyncSession, gamemode_id: int) -> None:
        """Delete gamemode"""
        gamemode = await self.repo.get(session, gamemode_id)
        if not gamemode:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Gamemode not found")

        await self.repo.delete(session, gamemode)
        await session.commit()


gamemodes = GamemodeAdminService()
