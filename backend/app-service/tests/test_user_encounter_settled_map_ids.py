"""Regression for `UserEncounterQueries.get_settled_map_ids`.

A refactor (ref(tournament): Drop leftover map-veto storage) dropped the
function-local `from src.services.user import _mappers` import while keeping
the `_mappers.settled_map_ids(...)` call, so every call raised
`NameError: name '_mappers' is not defined` in production.
"""

from __future__ import annotations

from types import SimpleNamespace
from unittest import IsolatedAsyncioTestCase

from src.services.user.queries.encounters import UserEncounterQueries


class _FakeResult:
    def __init__(self, rows: list[tuple]) -> None:
        self._rows = rows

    def all(self):
        return self._rows


class _FakeSession:
    def __init__(self, rows: list[tuple]) -> None:
        self._rows = rows

    async def execute(self, _query):
        return _FakeResult(self._rows)


class GetSettledMapIdsTests(IsolatedAsyncioTestCase):
    async def test_empty_ids_short_circuits_without_querying(self) -> None:
        session = SimpleNamespace(execute=None)  # would blow up if called
        result = await UserEncounterQueries().get_settled_map_ids(session, [])
        self.assertEqual({}, result)

    async def test_resolves_play_order_from_pick_ban_rows(self) -> None:
        # (encounter_id, item_id/map_id, status, action_index, order)
        rows = [
            (1, 101, "picked", None, 2),
            (1, 102, "picked", None, 1),
            (1, 103, "banned", None, 3),
        ]
        session = _FakeSession(rows)
        result = await UserEncounterQueries().get_settled_map_ids(session, [1])
        self.assertEqual({1: [102, 101]}, result)
