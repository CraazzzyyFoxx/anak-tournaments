"""Pool precedence at the native parser's pre-write boundary.

Actual game binding and rollback are exercised in test_stats_ingest_db.
"""

from types import SimpleNamespace
from unittest import IsolatedAsyncioTestCase
from unittest.mock import AsyncMock, patch

from src.services.match_logs import flows


def config(*, items=(), slots=(), stage_id=None, round=None):
    return SimpleNamespace(
        mode=flows.enums.MapVetoMode.SLOTS if slots else flows.enums.MapVetoMode.POOL,
        stage_id=stage_id,
        round=round,
        items=[SimpleNamespace(item_id=item) for item in items],
        slots=[
            SimpleNamespace(items=[SimpleNamespace(item_id=item) for item in candidates], reserve_item_id=reserve)
            for candidates, reserve in slots
        ],
    )


class MatchLogMapPoolTests(IsolatedAsyncioTestCase):
    async def validate(self, configs):
        processor = flows.MatchLogProcessor(SimpleNamespace(filename="new.log", discipline="overwatch"), None)
        with patch.object(flows.encounter_service, "bracket_positions", AsyncMock(return_value={7: (4, 2)})):
            await processor._validate_map_pool(
                AsyncMock(), SimpleNamespace(id=7), SimpleNamespace(id=3, name="Ilios"), configs
            )

    async def test_round_pool_overrides_tournament_pool(self):
        with self.assertRaises(flows.errors.ApiHTTPException) as error:
            await self.validate([config(items=(3,)), config(items=(8,), stage_id=4, round=2)])
        self.assertEqual("map_not_in_pool", error.exception.detail[0]["code"])

    async def test_candidates_reserves_and_flat_items_are_allowed(self):
        for pool in (config(items=(3,)), config(slots=(((3, 8), None),)), config(slots=(((8, 9), 3),))):
            with self.subTest(pool=pool):
                await self.validate([pool])

    async def test_no_pool_is_unrestricted_and_empty_template_inherits(self):
        for pools in ([], [config()], [config(items=(3,)), config(stage_id=4, round=2)]):
            await self.validate(pools)
        with self.assertRaises(flows.errors.ApiHTTPException):
            await self.validate([config(items=(8,)), config(stage_id=4, round=2)])
