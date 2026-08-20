"""Data access for per-visitor preferences (``players.favorite_player``).

Auth-account scoped, not player scoped: the row is owned by the caller's
``auth.user`` id, so it survives a player being re-linked or merged.
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.ext.asyncio import AsyncSession

from shared import models
from shared.repository.base import BaseRepository


class FavoritePlayerRepository(BaseRepository[models.FavoritePlayer]):
    def __init__(self) -> None:
        super().__init__(models.FavoritePlayer)

    async def get_for_player(
        self,
        session: AsyncSession,
        *,
        auth_user_id: int,
        player_id: int,
    ) -> models.FavoritePlayer | None:
        return await self.get_by(session, auth_user_id=auth_user_id, player_id=player_id)

    async def list_players(self, session: AsyncSession, auth_user_id: int) -> Sequence[sa.Row[tuple[int, str]]]:
        """``(player_id, player_name)`` newest-bookmark-first.

        Returns row tuples rather than ORM ``FavoritePlayer`` instances: the
        caller renders a name lookup, and loading the bookmark row plus its
        ``player`` relationship to reach two columns is pure waste.
        """
        result = await session.execute(
            sa.select(models.User.id, models.User.name)
            .join(models.FavoritePlayer, models.FavoritePlayer.player_id == models.User.id)
            .where(models.FavoritePlayer.auth_user_id == auth_user_id)
            .order_by(models.FavoritePlayer.created_at.desc())
        )
        return result.all()
