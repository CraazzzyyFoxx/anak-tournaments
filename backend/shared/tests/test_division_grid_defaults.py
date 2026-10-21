"""Every workspace game with a native ladder gets its own grid; v1 takes effect only where no division renumbers."""

from __future__ import annotations

import asyncio
import sys
import uuid
from datetime import UTC, datetime
from unittest import IsolatedAsyncioTestCase

import pytest
import sqlalchemy as sa
from sqlalchemy.ext.asyncio import AsyncSession

from shared import models
from shared.disciplines import discipline
from shared.domain.division_grid_defaults import default_grid_plan, unique_slug
from shared.services.division_grid import cache
from shared.services.division_grid.provisioning import provision_default_grids
from shared.testing import create_test_async_engine
from shared.testing.cache import configure_test_cache
from shared.testing.db import ensure_test_postgres

_GAME = {"has_ladder": True, "has_own_grid": False, "has_explicit_default": False}


@pytest.mark.parametrize(
    ("state", "plan"),
    [
        ({**_GAME, "has_system_grid": False, "has_tournaments": True, "fresh": False}, (True, True)),
        ({**_GAME, "has_system_grid": True, "has_tournaments": False, "fresh": True}, (True, True)),
        ({**_GAME, "has_system_grid": True, "has_tournaments": False, "fresh": False}, (True, False)),
        ({**_GAME, "has_system_grid": True, "has_tournaments": True, "fresh": True}, (True, False)),
        (
            {**_GAME, "has_explicit_default": True, "has_system_grid": False, "has_tournaments": False, "fresh": True},
            (True, False),
        ),
        (
            {**_GAME, "has_ladder": False, "has_system_grid": False, "has_tournaments": False, "fresh": True},
            (False, False),
        ),
        (
            {**_GAME, "has_own_grid": True, "has_system_grid": False, "has_tournaments": False, "fresh": True},
            (False, False),
        ),
    ],
    ids=[
        "no-system-grid-activates",
        "new-game-on-system-grid-unplayed-activates",
        "running-game-on-system-grid-stays-off",
        "new-game-on-system-grid-played-stays-off",
        "explicit-default-kept",
        "ladderless-skipped",
        "own-grid-skipped",
    ],
)
def test_default_grid_plan(state, plan):
    assert default_grid_plan(**state) == plan


def test_unique_slug_counts_up_from_two():
    assert unique_slug("lol-default", set()) == "lol-default"
    assert unique_slug("lol-default", {"lol-default", "lol-default-2"}) == "lol-default-3"


class ProvisionDefaultGridsTests(IsolatedAsyncioTestCase):
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
            slug=self.tag,
            name=self.tag,
            disciplines_enabled=["overwatch", "lol", "deadlock"],
            division_grid_defaults=[],
        )
        self.session.add(self.workspace)
        system = models.DivisionGridVersion(
            grid=models.DivisionGrid(slug=self.tag + "-system", name="System OW", discipline="overwatch"),
            version=1,
            label="System OW",
            status="published",
            tiers=[],
        )
        self.session.add(system)
        await self.session.flush()
        self.system_version_id = system.id

    async def asyncTearDown(self):
        await cache.invalidate_workspace(self.workspace.id)
        await self.session.close()
        await self.transaction.rollback()
        await self.connection.close()
        await self.engine.dispose()

    async def own_grids(self) -> dict[str, models.DivisionGrid]:
        grids = await self.session.scalars(
            sa.select(models.DivisionGrid).where(models.DivisionGrid.workspace_id == self.workspace.id)
        )
        return {grid.discipline: grid for grid in grids}

    async def test_played_system_game_gets_a_grid_but_keeps_its_divisions(self):
        self.session.add(models.Tournament(workspace_id=self.workspace.id, name="OW", slug=self.tag + "-ow"))
        await self.session.flush()
        await provision_default_grids(self.session, self.workspace)
        grids = await self.own_grids()
        self.assertEqual(set(grids), {"overwatch", "lol", "deadlock"})
        for code, grid in grids.items():
            (v1,) = grid.versions
            self.assertEqual((grid.slug, grid.name), (f"{code}-default", discipline(code).name))
            self.assertEqual(
                (v1.version, v1.status, v1.label), (1, "published", f"Default {discipline(code).name} grid")
            )
            self.assertEqual([tier.slug for tier in v1.tiers], [tier.slug for tier in discipline(code).native_ladder])
        self.assertEqual(
            self.workspace.default_division_grid_versions,
            {code: grids[code].versions[0].id for code in ("lol", "deadlock")},
        )
        await provision_default_grids(self.session, self.workspace)
        self.assertEqual(len(await self.own_grids()), 3)

    async def test_an_archived_grid_skips_its_game_and_an_explicit_default_stays(self):
        self.session.add_all(
            [
                models.DivisionGrid(
                    workspace_id=self.workspace.id,
                    slug="overwatch-default",
                    name="Old LoL",
                    discipline="lol",
                    archived_at=datetime.now(UTC),
                ),
                models.WorkspaceDivisionGridDefault(
                    workspace_id=self.workspace.id, discipline="overwatch", version_id=self.system_version_id
                ),
            ]
        )
        await self.session.flush()
        await provision_default_grids(self.session, self.workspace, disciplines={"overwatch", "lol"})
        grids = await self.own_grids()
        self.assertEqual((grids["overwatch"].slug, grids["lol"].name), ("overwatch-default-2", "Old LoL"))
        self.assertNotIn("deadlock", grids)
        await self.session.refresh(self.workspace, ["division_grid_defaults"])
        self.assertEqual(self.workspace.default_division_grid_versions, {"overwatch": self.system_version_id})
