"""A role's current division comes from its newest *ranked* tournament (contract: optional player rank)."""

from __future__ import annotations

import importlib
from types import SimpleNamespace
from unittest import IsolatedAsyncioTestCase
from unittest.mock import AsyncMock, patch

from shared.division_grid import DEFAULT_GRID
from shared.schemas.role import RoleRef

users = importlib.import_module("src.services.user.service").UserService.of("overwatch")
DAMAGE = RoleRef(dimension="player_role", role="damage")


class CurrentRoleDivisionTests(IsolatedAsyncioTestCase):
    async def _roles(self, entries: list[dict]):
        with patch.object(users.profile, "get_roles", AsyncMock(return_value=[(DAMAGE, 3, 1, entries)])):
            return await users.get_roles(SimpleNamespace(), 42, workspace_id=5, grid=DEFAULT_GRID)

    async def test_a_newer_unranked_tournament_keeps_the_ranked_division(self) -> None:
        (role,) = await self._roles(
            [
                {"tournament": 20, "rank": None, "division_grid_version_id": None},
                {"tournament": 10, "rank": 1500, "division_grid_version_id": None},
            ]
        )
        self.assertEqual(DEFAULT_GRID.resolve_division(1500).number, role.division)
        self.assertEqual(2, role.tournaments)

    async def test_a_role_never_ranked_has_no_division(self) -> None:
        (role,) = await self._roles([{"tournament": 20, "rank": None, "division_grid_version_id": None}])
        self.assertIsNone(role.division)
        self.assertEqual(1, role.tournaments)
