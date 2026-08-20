from collections.abc import Awaitable, Callable, Sequence
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from src import schemas
from src.core import pagination

from .service import StatisticsQueries
from .service import queries as statistics_queries

__all__ = ("StatisticsService", "statistics")

# ``(player_row, value)`` pairs plus the unpaginated total — the shape every
# leaderboard query on ``StatisticsQueries`` returns.
_Leaderboard = tuple[Sequence[tuple[Any, float | int]], int]


class StatisticsService:
    """The three player leaderboards, as ``Paginated[PlayerStatistics]``.

    All three differ only in which query feeds them and how the value is
    rounded, so they share one assembler instead of three copies of it.
    """

    def __init__(self, *, queries: StatisticsQueries = statistics_queries) -> None:
        self.queries = queries

    @staticmethod
    async def _paginate(
        query: Callable[[], Awaitable[_Leaderboard]],
        params: pagination.PaginationSortParams,
        *,
        round_to: int | None = None,
    ) -> pagination.Paginated[schemas.PlayerStatistics]:
        rows, total = await query()
        return pagination.Paginated(
            page=params.page,
            per_page=params.per_page,
            total=total,
            results=[
                schemas.PlayerStatistics(
                    id=player.id,
                    name=player.name,
                    value=round(value, round_to) if round_to is not None else value,
                )
                for player, value in rows
            ],
        )

    async def get_most_champions(
        self,
        session: AsyncSession,
        params: pagination.PaginationSortParams,
        workspace_id: int | None = None,
    ) -> pagination.Paginated[schemas.PlayerStatistics]:
        """Players ranked by championships won."""
        return await self._paginate(
            lambda: self.queries.get_top_champions(session, params, workspace_id=workspace_id),
            params,
        )

    async def get_to_winrate_players(
        self,
        session: AsyncSession,
        params: pagination.PaginationSortParams,
        workspace_id: int | None = None,
    ) -> pagination.Paginated[schemas.PlayerStatistics]:
        """Players ranked by map win rate. Rounded — the query returns a ratio."""
        return await self._paginate(
            lambda: self.queries.get_top_winrate_players(session, params, workspace_id=workspace_id),
            params,
            round_to=2,
        )

    async def get_to_won_players(
        self,
        session: AsyncSession,
        params: pagination.PaginationSortParams,
        workspace_id: int | None = None,
    ) -> pagination.Paginated[schemas.PlayerStatistics]:
        """Players ranked by maps won."""
        return await self._paginate(
            lambda: self.queries.get_top_won_players(session, params, workspace_id=workspace_id),
            params,
        )


statistics = StatisticsService()
