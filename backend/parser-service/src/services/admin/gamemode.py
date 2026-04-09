"""Admin service layer for gamemode CRUD operations"""

import sqlalchemy as sa
from fastapi import HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from shared.repository import BaseRepository

from src import models
from src.schemas import GamemodeRead
from src.schemas.admin import gamemode as admin_schemas

_repo = BaseRepository(models.Gamemode)


async def get_gamemodes(session: AsyncSession, params: admin_schemas.GamemodeListParams) -> dict:
    """Get paginated list of gamemodes"""
    filters: list[sa.ColumnElement[bool]] = []
    if params.search:
        filters.append(models.Gamemode.name.ilike(f"%{params.search}%"))

    gamemodes, total = await _repo.get_all(session, params, filters=filters)

    return {
        "results": [GamemodeRead.model_validate(gm, from_attributes=True) for gm in gamemodes],
        "total": total,
        "page": params.page,
        "per_page": params.per_page,
    }


async def create_gamemode(session: AsyncSession, data: admin_schemas.GamemodeCreate) -> models.Gamemode:
    """Create a new gamemode"""
    existing = await _repo.get_by(session, name=data.name)
    if existing:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Gamemode with name '{data.name}' already exists",
        )

    gamemode = models.Gamemode(name=data.name)
    return await _repo.create(session, gamemode)


async def update_gamemode(
    session: AsyncSession, gamemode_id: int, data: admin_schemas.GamemodeUpdate
) -> models.Gamemode:
    """Update gamemode fields"""
    gamemode = await _repo.get(session, gamemode_id)
    if not gamemode:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Gamemode not found")

    if data.name and data.name != gamemode.name:
        existing = await _repo.get_by(session, name=data.name)
        if existing:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Gamemode with name '{data.name}' already exists",
            )

    update_data = data.model_dump(exclude_unset=True)
    return await _repo.update(session, gamemode, update_data)


async def delete_gamemode(session: AsyncSession, gamemode_id: int) -> None:
    """Delete gamemode"""
    gamemode = await _repo.get(session, gamemode_id)
    if not gamemode:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Gamemode not found")

    await _repo.delete(session, gamemode)
