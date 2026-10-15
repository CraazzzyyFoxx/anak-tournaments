"""Owner-visible grid resolution with colliding OW/LoL rank bands in PostgreSQL."""

from __future__ import annotations

import asyncio
import sys
import uuid
from unittest import IsolatedAsyncioTestCase

import sqlalchemy as sa
from sqlalchemy.ext.asyncio import AsyncSession

from shared import models
from shared.core.errors import BaseAPIException
from shared.services.division_grid import cache
from shared.services.division_grid.access import (
    get_effective_division_grid,
    get_effective_division_grid_version,
    get_effective_division_grid_version_ids,
    get_workspace_division_grid_version_id,
    require_event_grid,
    tournament_effective_version_id_expr,
)
from shared.testing import create_test_async_engine
from shared.testing.cache import configure_test_cache
from shared.testing.db import ensure_test_postgres


class GridDisciplineTests(IsolatedAsyncioTestCase):
    if sys.platform == "win32":
        loop_factory = asyncio.SelectorEventLoop

    async def asyncSetUp(self):
        ensure_test_postgres()
        configure_test_cache()
        self.engine = create_test_async_engine()
        self.connection = await self.engine.connect()
        self.transaction = await self.connection.begin()
        self.session = AsyncSession(bind=self.connection, expire_on_commit=False)
        self.tag = uuid.uuid4().hex
        self.workspace = models.Workspace(slug=self.tag, name=self.tag, disciplines_enabled=["overwatch", "lol"])
        self.session.add(self.workspace)
        await self.session.flush()
        self.ow = await self.grid("overwatch", number=4)
        self.workspace.default_division_grid_version_id = self.ow.id
        self.ow_event = models.Tournament(workspace_id=self.workspace.id, name="OW", slug=self.tag + "-ow")
        self.lol_event = models.Tournament(
            workspace_id=self.workspace.id, name="LoL", slug=self.tag + "-lol", discipline="lol"
        )
        self.session.add_all([self.ow_event, self.lol_event])
        await self.session.flush()

    async def asyncTearDown(self):
        await cache.invalidate_workspace(self.workspace.id)
        await self.session.close()
        await self.transaction.rollback()
        await self.connection.close()
        await self.engine.dispose()

    async def grid(self, discipline, *, number=None, system=False):
        grid = models.DivisionGrid(
            workspace_id=None if system else self.workspace.id,
            slug=uuid.uuid4().hex,
            name=discipline,
            discipline=discipline,
        )
        version = models.DivisionGridVersion(grid=grid, version=1, label="v1", status="published", tiers=[])
        if number is not None:
            version.tiers.append(
                models.DivisionGridTier(
                    slug="same-rank-band",
                    number=number,
                    name=discipline,
                    sort_order=0,
                    rank_min=0,
                    rank_max=None,
                    icon_url="/tier.png",
                    native_rank_min=123,
                    native_rank_max=456,
                )
            )
        self.session.add(version)
        await self.session.flush()
        return version

    async def test_workspace_cache_keeps_both_disciplines_separate(self):
        lol = await self.grid("lol", number=9, system=True)
        for discipline, expected in [("overwatch", self.ow.id), ("lol", lol.id)] * 2:
            self.assertEqual(
                await get_workspace_division_grid_version_id(self.session, self.workspace.id, discipline), expected
            )
            grid = await get_effective_division_grid(self.session, self.workspace.id, discipline=discipline)
            self.assertEqual(grid.resolve_division(200).number, 4 if discipline == "overwatch" else 9)

    async def test_batch_sql_and_full_models_agree_on_each_owners_scope(self):
        lol = await self.grid("lol", number=9, system=True)
        expected = {self.ow_event.id: self.ow.id, self.lol_event.id: lol.id}
        for _ in range(2):
            self.assertEqual(await get_effective_division_grid_version_ids(self.session, expected), expected)
            rows = (
                await self.session.execute(
                    sa.select(models.Tournament.id, tournament_effective_version_id_expr(models.Tournament.id)).where(
                        models.Tournament.id.in_(expected)
                    )
                )
            ).all()
            self.assertEqual(dict(rows), expected)
            for event in (self.ow_event, self.lol_event):
                grid = await get_effective_division_grid(self.session, self.workspace.id, event.id)
                self.assertEqual(grid.version_id, expected[event.id])
                version = await get_effective_division_grid_version(self.session, self.workspace.id, event.id)
                self.assertEqual(
                    (version.id, version.tiers[0].native_rank_min, version.tiers[0].native_rank_max),
                    (expected[event.id], 123, 456),
                )

    async def test_missing_or_empty_lol_grid_never_becomes_an_overwatch_grid(self):
        for _ in range(2):
            for scope in ({"discipline": "lol"}, {"tournament_id": self.lol_event.id}):
                with self.assertRaises(BaseAPIException) as caught:
                    await get_effective_division_grid(self.session, self.workspace.id, **scope)
                self.assertEqual(caught.exception.status_code, 422)
                self.assertIn("division_grid_required", str(caught.exception.detail))
        empty = await self.grid("lol")
        self.workspace.default_division_grid_version_id = empty.id
        await self.session.flush()
        await cache.invalidate_workspace(self.workspace.id)
        with self.assertRaises(BaseAPIException):
            await get_effective_division_grid(self.session, self.workspace.id, discipline="lol")
        for version_id in (None, empty.id):
            with self.assertRaises(BaseAPIException) as caught:
                await require_event_grid(self.session, version_id=version_id, discipline="lol")
            self.assertIn("division_grid_required", str(caught.exception.detail))
        tiered = await self.grid("lol", number=9)
        await require_event_grid(self.session, version_id=tiered.id, discipline="lol")
        await require_event_grid(self.session, version_id=None, discipline="overwatch")

    async def test_foreign_explicit_pins_are_rejected_for_both_games(self):
        lol = await self.grid("lol", number=9)
        for version_id, discipline in ((self.ow.id, "lol"), (lol.id, "overwatch")):
            with self.assertRaises(BaseAPIException) as caught:
                await require_event_grid(self.session, version_id=version_id, discipline=discipline)
            self.assertEqual(caught.exception.status_code, 422)
        self.lol_event.division_grid_version_id = self.ow.id
        await self.session.flush()
        with self.assertRaises(BaseAPIException):
            await get_effective_division_grid(self.session, self.workspace.id, self.lol_event.id)

    async def test_workspace_invalidation_clears_each_disciplines_warmed_default(self):
        lol = await self.grid("lol", number=9)
        await get_workspace_division_grid_version_id(self.session, self.workspace.id, "overwatch")
        self.workspace.default_division_grid_version_id = lol.id
        await self.session.flush()
        await cache.invalidate_workspace(self.workspace.id)
        self.assertEqual(await get_workspace_division_grid_version_id(self.session, self.workspace.id, "lol"), lol.id)
        self.assertNotEqual(
            await get_workspace_division_grid_version_id(self.session, self.workspace.id, "overwatch"), lol.id
        )
