from __future__ import annotations

from collections.abc import Sequence

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from shared import models
from shared.repository.base import BaseRepository

__all__ = ("CasualMatchRepository", "CasualTeamRepository", "CasualPlayerRepository")


class CasualMatchRepository(BaseRepository[models.CasualMatch]):
    def __init__(self) -> None:
        super().__init__(models.CasualMatch)

    async def list_for_custom_game(self, session: AsyncSession, custom_game_id: int) -> Sequence[models.CasualMatch]:
        """Newest-first, with both scored sides and their frozen seats loaded.

        Eager, not lazy: an async session raises on an unawaited lazy load, and
        both readers of this need the whole snapshot -- the history view for
        names and scores, the rotation recommender for who actually played.
        """
        result = await session.scalars(
            self.select()
            .where(self.model.custom_game_id == custom_game_id)
            .options(selectinload(self.model.teams).selectinload(models.CasualTeam.players))
            .order_by(self.model.id.desc())
        )
        return result.all()


class CasualTeamRepository(BaseRepository[models.CasualTeam]):
    def __init__(self) -> None:
        super().__init__(models.CasualTeam)


class CasualPlayerRepository(BaseRepository[models.CasualPlayer]):
    def __init__(self) -> None:
        super().__init__(models.CasualPlayer)
