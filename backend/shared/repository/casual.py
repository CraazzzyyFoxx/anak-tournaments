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
        """Newest-first, with both sides' frozen team names eager-loaded.

        Eager, not lazy: an async session raises on an unawaited lazy load
        accessed after the fact, and the history view needs both team names for
        every row regardless of who scored.
        """
        result = await session.scalars(
            self.select()
            .where(self.model.custom_game_id == custom_game_id)
            .options(selectinload(self.model.home_team), selectinload(self.model.away_team))
            .order_by(self.model.id.desc())
        )
        return result.all()


class CasualTeamRepository(BaseRepository[models.CasualTeam]):
    def __init__(self) -> None:
        super().__init__(models.CasualTeam)


class CasualPlayerRepository(BaseRepository[models.CasualPlayer]):
    def __init__(self) -> None:
        super().__init__(models.CasualPlayer)

    async def list_for_teams(self, session: AsyncSession, team_ids: Sequence[int]) -> Sequence[models.CasualPlayer]:
        """Every seat frozen for a set of casual teams, unordered.

        Bulk by design: a rotation read over N recorded matches needs the
        rosters of 2N teams, and one ``IN`` query beats N+1 round trips.
        """
        if not team_ids:
            return []
        result = await session.scalars(self.select().where(self.model.team_id.in_(team_ids)))
        return result.all()
