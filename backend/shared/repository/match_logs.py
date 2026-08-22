from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.ext.asyncio import AsyncSession

from shared import models
from shared.core import enums
from shared.repository.base import BaseRepository


class MatchStatisticsRepository(BaseRepository[models.MatchStatistics]):
    def __init__(self) -> None:
        super().__init__(models.MatchStatistics)

    async def delete_for_match(self, session: AsyncSession, match_id: int) -> None:
        await session.execute(sa.delete(models.MatchStatistics).where(models.MatchStatistics.match_id == match_id))

    async def delete_for_match_by_names(
        self,
        session: AsyncSession,
        match_id: int,
        names: Sequence[enums.LogStatsName],
    ) -> None:
        """Wipe only the named stats for a match — the impact backfill's targeted
        re-derive-and-replace of its 7 derived stats, leaving every other stat
        (raw log-derived rows) untouched."""
        await session.execute(
            sa.delete(models.MatchStatistics).where(
                models.MatchStatistics.match_id == match_id,
                models.MatchStatistics.name.in_(names),
            )
        )


class MatchEventRepository(BaseRepository[models.MatchEvent]):
    def __init__(self) -> None:
        super().__init__(models.MatchEvent)

    async def delete_for_match(self, session: AsyncSession, match_id: int) -> None:
        await session.execute(sa.delete(models.MatchEvent).where(models.MatchEvent.match_id == match_id))


class MatchKillFeedRepository(BaseRepository[models.MatchKillFeed]):
    def __init__(self) -> None:
        super().__init__(models.MatchKillFeed)

    async def delete_for_match(self, session: AsyncSession, match_id: int) -> None:
        await session.execute(sa.delete(models.MatchKillFeed).where(models.MatchKillFeed.match_id == match_id))

    async def list_for_match(self, session: AsyncSession, match_id: int) -> Sequence[models.MatchKillFeed]:
        result = await session.execute(
            sa.select(models.MatchKillFeed).where(models.MatchKillFeed.match_id == match_id)
        )
        return result.scalars().all()
