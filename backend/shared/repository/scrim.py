"""Scrim-room CRUD (``scrim_room``)."""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm.strategy_options import _AbstractLoad

from shared import models
from shared.repository.base import BaseRepository


class ScrimRoomRepository(BaseRepository[models.ScrimRoom]):
    def __init__(self) -> None:
        super().__init__(models.ScrimRoom)

    async def get_by_token(
        self,
        session: AsyncSession,
        token: str,
        *,
        options: Sequence[_AbstractLoad] | None = None,
    ) -> models.ScrimRoom | None:
        return await self.get_by(session, options=options, token=token)

    async def list_for_workspace(
        self,
        session: AsyncSession,
        workspace_id: int,
        *,
        include_closed: bool = False,
        tournament_id: int | None = None,
        options: Sequence[_AbstractLoad] | None = None,
    ) -> Sequence[models.ScrimRoom]:
        filters: list[sa.ColumnElement[bool]] = [models.ScrimRoom.workspace_id == workspace_id]
        if not include_closed:
            filters.append(models.ScrimRoom.closed_at.is_(None))
        if tournament_id is not None:
            filters.append(models.ScrimRoom.tournament_id == tournament_id)
        query = self._apply_options(
            self.select().where(*filters).order_by(models.ScrimRoom.id.desc()), options
        )
        result = await session.execute(query)
        return result.unique().scalars().all()


__all__ = ("ScrimRoomRepository",)
