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
from shared.repository.workspace import WorkspaceRepository
from shared.services.division_grid import cache
from shared.services.division_grid.access import (
    build_workspace_division_grid_normalizer,
    get_effective_division_grid,
    get_effective_division_grid_version,
    get_effective_division_grid_version_ids,
    get_workspace_division_grid_version_id,
    require_event_grid,
    tournament_effective_version_id_expr,
)
from shared.services.division_grid.normalization import DivisionGridNormalizationError
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
        self.workspace = models.Workspace(
            slug=self.tag, name=self.tag, disciplines_enabled=["overwatch", "lol"], division_grid_defaults=[]
        )
        self.session.add(self.workspace)
        await self.session.flush()
        self.ow = await self.grid("overwatch", number=4)
        await WorkspaceRepository().set_default_grid_version(
            self.session, self.workspace, discipline="overwatch", version_id=self.ow.id
        )
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
        lol = await self.grid("lol", number=9)
        await WorkspaceRepository().set_default_grid_version(
            self.session, self.workspace, discipline="lol", version_id=lol.id
        )
        for discipline, expected in [("overwatch", self.ow.id), ("lol", lol.id)] * 2:
            self.assertEqual(
                await get_workspace_division_grid_version_id(self.session, self.workspace.id, discipline), expected
            )
            grid = await get_effective_division_grid(self.session, self.workspace.id, discipline=discipline)
            self.assertEqual(grid.resolve_division(200).number, 4 if discipline == "overwatch" else 9)

    async def test_batch_sql_and_full_models_agree_on_each_owners_scope(self):
        lol = await self.grid("lol", number=9)
        await WorkspaceRepository().set_default_grid_version(
            self.session, self.workspace, discipline="lol", version_id=lol.id
        )
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

    async def test_a_missing_lol_grid_resolves_lols_own_ladder_never_overwatchs(self):
        self.workspace.disciplines_enabled = ["lol", "overwatch"]
        await self.session.flush()
        grid = await get_effective_division_grid(self.session, self.workspace.id)
        self.assertEqual(grid.tiers[0].slug, "challenger")
        for _ in range(2):
            for scope in ({"discipline": "lol"}, {"tournament_id": self.lol_event.id}):
                grid = await get_effective_division_grid(self.session, self.workspace.id, **scope)
                self.assertEqual(grid.tiers[0].slug, "challenger")
        empty = await self.grid("lol")
        await WorkspaceRepository().set_default_grid_version(
            self.session, self.workspace, discipline="lol", version_id=empty.id
        )
        await cache.invalidate_workspace(self.workspace.id)
        grid = await get_effective_division_grid(self.session, self.workspace.id, discipline="lol")
        self.assertEqual(grid.tiers[0].slug, "challenger")
        for version_id in (None, empty.id):
            await require_event_grid(self.session, version_id=version_id, discipline="lol")
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
        await WorkspaceRepository().set_default_grid_version(
            self.session, self.workspace, discipline="lol", version_id=lol.id
        )
        await cache.invalidate_workspace(self.workspace.id)
        self.assertEqual(await get_workspace_division_grid_version_id(self.session, self.workspace.id, "lol"), lol.id)
        self.assertEqual(
            await get_workspace_division_grid_version_id(self.session, self.workspace.id, "overwatch"), self.ow.id
        )

    async def test_corrupt_default_and_foreign_normalization_never_return_another_owners_grid(self):
        lol = await self.grid("lol", number=9)
        self.session.add(
            models.WorkspaceDivisionGridDefault(workspace_id=self.workspace.id, discipline="lol", version_id=self.ow.id)
        )
        await self.session.flush()
        with self.assertRaises(BaseAPIException):
            await get_workspace_division_grid_version_id(self.session, self.workspace.id, "lol")
        sql_version = await self.session.scalar(
            sa.select(tournament_effective_version_id_expr(sa.literal(self.lol_event.id)))
        )
        self.assertNotEqual(sql_version, self.ow.id)
        with self.assertRaises(DivisionGridNormalizationError):
            await build_workspace_division_grid_normalizer(
                self.session, self.workspace.id, target_version_id=lol.id, source_version_ids=[self.ow.id]
            )
        other = models.Workspace(slug=self.tag + "-other", name="Other")
        self.session.add(other)
        await self.session.flush()
        lol.grid.workspace_id = other.id
        await self.session.execute(
            sa.update(models.WorkspaceDivisionGridDefault)
            .where(
                models.WorkspaceDivisionGridDefault.workspace_id == self.workspace.id,
                models.WorkspaceDivisionGridDefault.discipline == "lol",
            )
            .values(version_id=lol.id)
        )
        await self.session.flush()
        with self.assertRaises(BaseAPIException):
            await get_workspace_division_grid_version_id(self.session, self.workspace.id, "lol")
        with self.assertRaises(DivisionGridNormalizationError):
            await build_workspace_division_grid_normalizer(self.session, self.workspace.id, target_version_id=lol.id)

    async def test_independent_concurrent_upserts_preserve_both_defaults(self):
        # Separate committed fixture: two transactions must see the same owner,
        # unlike the rollback-only per-test transaction used by the other cases.
        repo = WorkspaceRepository()
        async with AsyncSession(self.engine, expire_on_commit=False) as setup:
            workspace = models.Workspace(
                slug=self.tag + "-concurrent",
                name="Concurrent",
                disciplines_enabled=["overwatch", "lol"],
                division_grid_defaults=[],
            )
            setup.add(workspace)
            await setup.flush()
            workspace_id = workspace.id
            versions = {}
            for code in ("overwatch", "lol"):
                grid = models.DivisionGrid(workspace_id=workspace_id, slug=code, name=code, discipline=code)
                version = models.DivisionGridVersion(grid=grid, version=1, label=code, status="published")
                setup.add(version)
                await setup.flush()
                versions[code] = version.id
            await setup.commit()
        ready = asyncio.Event()
        arrived = 0

        async def activate(code):
            nonlocal arrived
            async with AsyncSession(self.engine, expire_on_commit=False) as session:
                owner = await repo.get(session, workspace_id)
                arrived += 1
                if arrived == 2:
                    ready.set()
                await ready.wait()
                await repo.set_default_grid_version(session, owner, discipline=code, version_id=versions[code])
                await session.commit()

        try:
            await asyncio.gather(activate("overwatch"), activate("lol"))
            async with AsyncSession(self.engine) as session:
                owner = await repo.get_with_default_grid(session, workspace_id)
                self.assertEqual(owner.default_division_grid_versions, versions)
        finally:
            async with AsyncSession(self.engine) as session:
                await session.execute(sa.delete(models.Workspace).where(models.Workspace.id == workspace_id))
                await session.commit()
