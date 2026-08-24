"""Admin service layer for map CRUD operations"""

from __future__ import annotations

import sqlalchemy as sa
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from shared.catalog_aliases import normalize_aliases
from shared.core import http_status as status
from shared.core.errors import BaseAPIException as HTTPException
from shared.core.pagination import paginated_dict
from shared.repository import GamemodeRepository, MapRepository
from src import models, schemas
from src.schemas import MapRead

__all__ = ("MapAdminService", "maps", "normalize_aliases")


class MapAdminService:
    def __init__(
        self,
        *,
        repo: MapRepository = MapRepository(),
        gamemodes: GamemodeRepository = GamemodeRepository(),
    ) -> None:
        self.repo = repo
        self.gamemodes = gamemodes

    async def get_maps(self, session: AsyncSession, params: schemas.MapListParams) -> dict:
        """Get paginated list of maps"""
        filters: list[sa.ColumnElement[bool]] = []
        if params.search:
            search_term = f"%{params.search}%"
            filters.append(models.Map.name.ilike(search_term))

        if params.gamemode_id is not None:
            filters.append(models.Map.gamemode_id == params.gamemode_id)

        maps_page, total = await self.repo.list(
            session,
            params,
            filters=filters,
            options=[selectinload(models.Map.gamemode)],
        )

        return paginated_dict(
            [MapRead.model_validate(map_obj, from_attributes=True) for map_obj in maps_page],
            total,
            params,
        )

    async def create_map(self, session: AsyncSession, data: schemas.MapCreate) -> models.Map:
        """Create a new map"""
        gamemode = await self.gamemodes.get(session, data.gamemode_id)

        if not gamemode:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Gamemode not found")

        existing_map = await self.repo.get_by_name(session, data.name)

        if existing_map:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Map with name '{data.name}' already exists",
            )

        map_obj = models.Map(
            name=data.name,
            gamemode_id=data.gamemode_id,
            image_path=data.image_path or "",
            in_competitive=data.in_competitive,
            aliases=normalize_aliases(data.aliases or [], canonical=data.name),
        )

        await self.repo.create(session, map_obj)
        await session.commit()
        await session.refresh(map_obj, ["gamemode"])

        return map_obj

    async def update_map(self, session: AsyncSession, map_id: int, data: schemas.MapUpdate) -> models.Map:
        """Update map fields"""
        map_obj = await self.repo.get_expanded(session, map_id, ("gamemode",))

        if not map_obj:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Map not found")

        if data.gamemode_id:
            gamemode = await self.gamemodes.get(session, data.gamemode_id)

            if not gamemode:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="Gamemode not found",
                )

        if data.name and data.name != map_obj.name:
            existing_map = await self.repo.get_by_name(session, data.name)

            if existing_map:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"Map with name '{data.name}' already exists",
                )

        update_data = data.model_dump(exclude_unset=True)
        if "aliases" in update_data:
            update_data["aliases"] = normalize_aliases(
                update_data["aliases"] or [], canonical=update_data.get("name") or map_obj.name
            )
        await self.repo.update_fields(session, map_obj, update_data)
        await session.commit()
        await session.refresh(map_obj, ["gamemode"])

        return map_obj

    async def delete_map(self, session: AsyncSession, map_id: int) -> None:
        """Delete map"""
        map_obj = await self.repo.get(session, map_id)

        if not map_obj:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Map not found")

        await self.repo.delete(session, map_obj)
        await session.commit()


maps = MapAdminService()
