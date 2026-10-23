"""A role's current division comes from its newest *ranked* tournament, pooled across its sub-roles."""

from __future__ import annotations

import importlib
from types import SimpleNamespace
from unittest import IsolatedAsyncioTestCase
from unittest.mock import AsyncMock, patch

from shared.division_grid import DEFAULT_GRID
from shared.schemas.role import RoleRef

users = importlib.import_module("src.services.user.service").UserService.of("overwatch")
DAMAGE = RoleRef(dimension="player_role", role="damage")
HITSCAN = RoleRef(dimension="player_role", role="damage_hitscan", parent="damage")


def _entry(tournament: int, rank: int | None, recency: int) -> dict:
    return {"tournament": tournament, "rank": rank, "division_grid_version_id": None, "recency": recency}


class CurrentRoleDivisionTests(IsolatedAsyncioTestCase):
    async def _roles(self, rows: list[tuple[RoleRef, list[dict]]]):
        returned = [(role, 3, 1, entries) for role, entries in rows]
        with patch.object(users.profile, "get_roles", AsyncMock(return_value=returned)):
            return await users.get_roles(SimpleNamespace(), 42, workspace_id=5, grid=DEFAULT_GRID)

    async def test_a_newer_unranked_tournament_keeps_the_ranked_division(self) -> None:
        (role,) = await self._roles([(DAMAGE, [_entry(20, None, 1), _entry(10, 1500, 2)])])
        self.assertEqual(DEFAULT_GRID.resolve_division(1500).number, role.division)
        self.assertEqual(2, role.tournaments)

    async def test_a_role_never_ranked_has_no_division(self) -> None:
        (role,) = await self._roles([(DAMAGE, [_entry(20, None, 1)])])
        self.assertIsNone(role.division)
        self.assertEqual(1, role.tournaments)

    async def test_sub_roles_pool_into_their_role(self) -> None:
        # damage_hitscan is Damage: one row, its record pooled, its division the newest ranked of either (the plain
        # damage row's 3000, not hitscan's older 2000); a never-ranked role comes last.
        never = RoleRef(dimension="player_role", role="tank")
        roles = await self._roles(
            [
                (HITSCAN, [_entry(5, 2000, 4)]),
                (never, [_entry(30, None, 1)]),
                (DAMAGE, [_entry(20, None, 1), _entry(12, 3000, 2)]),
            ]
        )
        self.assertEqual([DAMAGE, never], [role.role for role in roles])
        damage = roles[0]
        self.assertEqual(DEFAULT_GRID.resolve_division(3000).number, damage.division)
        self.assertEqual((3, 6, 8), (damage.tournaments, damage.maps_won, damage.maps))
