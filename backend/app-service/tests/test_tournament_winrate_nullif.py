"""0-0 encounters must not divide by zero in tournament winrate SQL.

OWT-TOURNAMENTS-29M: ``sum(maps_won) / (sum(won)+sum(lost))`` is 0/0 when a
player's only encounters are unplayed/0-0, and Postgres aborts the whole
profile query with DivisionByZeroError.
"""

from __future__ import annotations

import inspect
from types import SimpleNamespace
from unittest import IsolatedAsyncioTestCase

from sqlalchemy.dialects import postgresql

from src.services.statistics.queries import StatisticsQueries, queries


class _Capture:
    def first(self):
        return None


class _Session:
    def __init__(self) -> None:
        self.statement = None

    async def execute(self, statement):
        self.statement = statement
        return _Capture()


class TournamentWinrateNullifTests(IsolatedAsyncioTestCase):
    async def test_winrate_sql_nullif_protects_zero_maps(self) -> None:
        session = _Session()
        await queries.get_tournament_winrate(session, SimpleNamespace(id=1), user_id=1)
        sql = str(session.statement.compile(dialect=postgresql.dialect())).lower()
        self.assertIn("nullif", sql)

    def test_leaderboard_winrate_uses_nullif(self) -> None:
        self.assertIn("nullif", inspect.getsource(StatisticsQueries.get_top_winrate_players).lower())
