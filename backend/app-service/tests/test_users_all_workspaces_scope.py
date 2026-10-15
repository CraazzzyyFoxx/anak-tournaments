"""The public ``/users`` surface can be read across every workspace on purpose.

``?workspace_id=all`` is the opt-in: it resolves to the ``ALL_WORKSPACES``
sentinel, so the read is unfiltered *deliberately* while a missing
``workspace_id`` still fails closed with 400 (cross-tenant leak guard).

In that mode there is no single grid to normalize ranks onto: a division
number is only meaningful together with the grid it was resolved on, so every
role reports its own tournament's effective grid version (own pin -> owning
workspace default -> system default) and the response ships those grids.

Postgres-backed assertions live with the integration suites; these run without
a database — pure parsing, SQL shape, and the resolution layer with the cached
grid loaders stubbed.
"""

from __future__ import annotations

import importlib
from unittest import IsolatedAsyncioTestCase, TestCase
from unittest.mock import AsyncMock, patch

import pytest
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from shared.core.errors import BaseAPIException
from shared.division_grid import DEFAULT_GRID
from shared.rpc import common as rpc_common
from shared.rpc.query import build_query_model
from shared.schemas.role import RoleRef
from shared.services.division_grid.normalization import DivisionGridNormalizer
from shared.services.workspace_scope import ALL_WORKSPACES
from shared.testing.factories import division_grid as make_grid
from src import models, schemas
from src.services.user.queries import _scope

user_rpc = importlib.import_module("src.rpc.users")
user_service = importlib.import_module("src.services.user.service")
enums = importlib.import_module("src.core.enums")


def _query(**params: str) -> dict:
    return {"query": {key: [value] for key, value in params.items()}}


def _compiled(stmt) -> str:
    return str(stmt.compile(dialect=postgresql.dialect(), compile_kwargs={"literal_binds": True}))


def _version_payload(version_id: int) -> dict:
    return {
        "id": version_id,
        "grid_id": version_id * 10,
        "version": 1,
        "label": f"Grid {version_id}",
        "status": "published",
        "created_from_version_id": None,
        "published_at": None,
        "tiers": [],
    }


class WorkspaceScopeParsingTests(TestCase):
    def test_all_is_the_explicit_cross_workspace_opt_in(self) -> None:
        self.assertIs(ALL_WORKSPACES, rpc_common.q_workspace_scope(_query(workspace_id="all")))

    def test_integer_is_a_scoped_read(self) -> None:
        self.assertEqual(7, rpc_common.q_workspace_scope(_query(workspace_id="7")))

    def test_missing_or_malformed_scope_is_not_an_opt_in(self) -> None:
        self.assertIsNone(rpc_common.q_workspace_scope({}))
        self.assertIsNone(rpc_common.q_workspace_scope(_query(workspace_id="everything")))

    def test_users_read_fails_closed_without_a_scope(self) -> None:
        with pytest.raises(BaseAPIException) as excinfo:
            user_rpc._ws_id({})
        self.assertEqual(400, excinfo.value.status_code)

        with pytest.raises(BaseAPIException):
            user_rpc._ws_id(_query(workspace_id="not-a-workspace"))

    def test_users_read_drops_the_filter_only_for_the_explicit_all(self) -> None:
        self.assertIsNone(user_rpc._ws_id(_query(workspace_id="all")))
        self.assertEqual(7, user_rpc._ws_id(_query(workspace_id="7")))


class OverviewDivisionFilterTests(TestCase):
    """The ``divisions`` chips cannot be translated once for everyone."""

    def test_scoped_read_filters_on_indexable_rank_ranges(self) -> None:
        sql = _compiled(
            _scope._apply_overview_role_filters(
                sa.select(models.User.id),
                role=None,
                divisions=[3, 5],
                grid=DEFAULT_GRID,
                workspace_id=7,
            )
        )
        self.assertIn("player.rank >= ", sql)
        self.assertNotIn("division_grid_tier", sql)
        # A set of divisions is an OR of per-division rank ranges, not one span:
        # picking 3 and 5 must not drag 4 in with them.
        self.assertIn(" OR ", sql)

    def test_a_division_set_keeps_every_picked_division(self) -> None:
        picked = _compiled(
            _scope._apply_overview_role_filters(
                sa.select(models.User.id),
                role=None,
                divisions=[3],
                grid=DEFAULT_GRID,
                workspace_id=7,
            )
        )
        bounds = {tier.number: (tier.rank_min, tier.rank_max) for tier in DEFAULT_GRID.tiers if tier.number in (3, 5)}
        self.assertIn(f"player.rank >= {bounds[3][0]}", picked)
        self.assertNotIn(f"player.rank >= {bounds[5][0]}", picked)

    def test_no_divisions_is_no_division_filter(self) -> None:
        sql = _compiled(
            _scope._apply_overview_role_filters(
                sa.select(models.User.id),
                role=RoleRef(dimension="player_role", role="tank"),
                divisions=[],
                grid=DEFAULT_GRID,
                workspace_id=7,
            )
        )
        self.assertNotIn("player.rank", sql)
        self.assertNotIn("division_grid_tier", sql)
        for query_model, params_model in (
            (schemas.UserOverviewQueryParams, schemas.UserOverviewParams),
            (schemas.UserCatalogQueryParams, schemas.UserCatalogParams),
        ):
            self.assertFalse(params_model.from_query_params(build_query_model(query_model, {})).has_role_filter)
            unassigned = params_model.from_query_params(build_query_model(query_model, {"role": ["null"]}))
            self.assertTrue(unassigned.has_role_filter)
            self.assertIsNone(unassigned.role)
            role = RoleRef(dimension="position", role="support")
            selected = params_model.from_query_params(
                build_query_model(query_model, {"role": [role.model_dump_json()]})
            )
            self.assertEqual(role, selected.role)
        unassigned_sql = _compiled(
            _scope._apply_overview_role_filters(
                sa.select(models.User.id),
                role=None,
                has_role_filter=True,
                grid=DEFAULT_GRID,
            )
        )
        self.assertIn("NOT (EXISTS", unassigned_sql)
        self.assertIn("catalog.role_dimension.rated IS true", unassigned_sql)

    def test_has_logs_filter_probes_match_statistics_per_user(self) -> None:
        sql = _compiled(_scope.apply_has_logs_filter(sa.select(models.User.id)))
        self.assertIn("EXISTS", sql)
        self.assertIn('matches.statistics.user_id = players."user".id', sql)


class OverviewRoleDivisionTests(IsolatedAsyncioTestCase):
    # Same rank, two grids: workspace A's grid calls 2500 division 2,
    # workspace B's grid calls the very same rank division 9.
    GRID_A = make_grid(101, ((1011, 1, 3000, None), (1012, 2, 2000, 2999), (1013, 3, 0, 1999)))
    GRID_B = make_grid(202, ((2021, 8, 3000, None), (2022, 9, 2000, 2999), (2023, 10, 0, 1999)))

    async def _resolve(self, raw_roles_map, *, workspace_id, normalizer=None):
        grids = {101: self.GRID_A, 202: self.GRID_B}
        with (
            patch.object(
                user_service,
                "load_division_grids",
                AsyncMock(side_effect=lambda _session, ids: {vid: grids[vid] for vid in ids}),
            ),
            patch.object(
                user_service,
                "load_division_grid_version_read_payloads",
                AsyncMock(side_effect=lambda _session, ids: {vid: _version_payload(vid) for vid in ids}),
            ),
        ):
            return await user_service._overview_role_divisions(
                object(),
                raw_roles_map,
                grid=DEFAULT_GRID,
                normalizer=normalizer,
                workspace_id=workspace_id,
            )

    async def test_each_role_keeps_the_grid_its_rank_was_played_on(self) -> None:
        roles_by_user, division_grids = await self._resolve(
            {
                1: [(RoleRef(dimension="player_role", role="tank"), 2500, 101)],
                2: [(RoleRef(dimension="player_role", role="tank"), 2500, 202)],
            },
            workspace_id=None,
        )

        self.assertEqual([(2, 101)], [(r.division, r.division_grid_version_id) for r in roles_by_user[1]])
        self.assertEqual([(9, 202)], [(r.division, r.division_grid_version_id) for r in roles_by_user[2]])
        # Every referenced grid ships once so the client can label both numbers.
        self.assertEqual([101, 202], [grid.id for grid in division_grids])

    async def test_one_user_can_hold_divisions_from_two_grids(self) -> None:
        roles_by_user, division_grids = await self._resolve(
            {
                1: [
                    (RoleRef(dimension="player_role", role="tank"), 2500, 101),
                    (RoleRef(dimension="player_role", role="support"), 2500, 202),
                ]
            },
            workspace_id=None,
        )

        self.assertEqual([(2, 101), (9, 202)], [(r.division, r.division_grid_version_id) for r in roles_by_user[1]])
        self.assertEqual([101, 202], [grid.id for grid in division_grids])

    async def test_scoped_read_normalizes_every_role_onto_the_workspace_grid(self) -> None:
        # Workspace 7 targets grid 101: a rank played on grid 202 is normalized
        # (here: no mapping, so it falls back), and *every* role reports the one
        # target version — the division numbers are comparable within the page.
        normalizer = DivisionGridNormalizer(
            target_version_id=101,
            target_grid=self.GRID_A,
            source_grids_by_version_id={101: self.GRID_A},
            primary_target_by_source_tier_id={},
            weighted_targets_by_source_tier_id={},
        )
        roles_by_user, division_grids = await self._resolve(
            {
                1: [
                    (RoleRef(dimension="player_role", role="tank"), 2500, 101),
                    (RoleRef(dimension="player_role", role="support"), 2500, 202),
                ]
            },
            workspace_id=7,
            normalizer=normalizer,
        )

        self.assertEqual({101}, {role.division_grid_version_id for role in roles_by_user[1]})
        self.assertEqual([101], [grid.id for grid in division_grids])
        self.assertEqual(2, roles_by_user[1][0].division)
