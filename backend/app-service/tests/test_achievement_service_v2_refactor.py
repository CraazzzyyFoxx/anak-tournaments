from __future__ import annotations

from types import SimpleNamespace
from unittest import IsolatedAsyncioTestCase
from unittest.mock import AsyncMock

from src.services.achievements.queries import queries  # noqa: E402


class AchievementQueryTests(IsolatedAsyncioTestCase):
    async def test_get_uses_outer_join_for_zero_rarity_rules(self) -> None:
        captured_queries = []

        async def execute_side_effect(query):
            captured_queries.append(query)
            return SimpleNamespace(first=lambda: None)

        session = SimpleNamespace(execute=AsyncMock(side_effect=execute_side_effect))

        await queries.get(session, 123, [], workspace_id=77)

        self.assertEqual(1, len(captured_queries))
        self.assertIn("LEFT OUTER JOIN", str(captured_queries[0]).upper())
