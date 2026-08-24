from __future__ import annotations

from collections.abc import Sequence

from sqlalchemy.ext.asyncio import AsyncSession

from shared import models
from shared.repository.base import BaseRepository


class CustomGameRepository(BaseRepository[models.CustomGame]):
    def __init__(self) -> None:
        super().__init__(models.CustomGame)

    async def list_for_workspace(self, session: AsyncSession, workspace_id: int) -> Sequence[models.CustomGame]:
        result = await session.scalars(
            self.select().where(self.model.workspace_id == workspace_id).order_by(self.model.id.desc())
        )
        return result.all()


class CustomGamePlayerRepository(BaseRepository[models.CustomGamePlayer]):
    def __init__(self) -> None:
        super().__init__(models.CustomGamePlayer)

    async def list_for_game(self, session: AsyncSession, custom_game_id: int) -> Sequence[models.CustomGamePlayer]:
        result = await session.scalars(
            self.select()
            .where(self.model.custom_game_id == custom_game_id)
            .order_by(self.model.sort_order, self.model.id)
        )
        return result.all()

    async def delete_for_game(self, session: AsyncSession, custom_game_id: int) -> None:
        for row in await self.list_for_game(session, custom_game_id):
            await self.delete(session, row)
