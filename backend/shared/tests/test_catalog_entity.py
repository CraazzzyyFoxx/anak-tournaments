"""DB guarantees of ``catalog.entity`` (§14.2, D85, D101) and the scoped repository. Needs the test Postgres."""

from __future__ import annotations

import asyncio
import itertools
import os
import sys
from unittest import IsolatedAsyncioTestCase

import sqlalchemy as sa
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import async_sessionmaker

from scripts.export_db_schema import column_line
from shared.models.catalog.entity import CatalogEntity, CatalogEntityLegacy
from shared.repository import CatalogEntityRepository
from shared.testing import create_test_async_engine
from shared.testing.db import ensure_test_postgres

_TAG = itertools.count()


def test_legacy_keys_are_not_documented_as_generated_ids() -> None:
    columns = CatalogEntityLegacy.__table__.columns
    assert "increment" not in column_line(columns.legacy_kind)
    assert "increment" not in column_line(columns.legacy_id)


class CatalogEntityTests(IsolatedAsyncioTestCase):
    if sys.platform == "win32":
        loop_factory = asyncio.SelectorEventLoop  # psycopg async cannot run on the Proactor loop

    async def asyncSetUp(self) -> None:
        ensure_test_postgres()
        self.engine = create_test_async_engine()
        self.Session = async_sessionmaker(self.engine, expire_on_commit=False)
        self.tag = f"cat-{os.getpid()}-{next(_TAG)}"

    async def asyncTearDown(self) -> None:
        async with self.Session() as s:
            # Children first: a map's parent FK points at its mode.
            await s.execute(
                sa.delete(CatalogEntity).where(
                    CatalogEntity.slug.like(f"{self.tag}%"), CatalogEntity.parent_id.is_not(None)
                )
            )
            await s.execute(sa.delete(CatalogEntity).where(CatalogEntity.slug.like(f"{self.tag}%")))
            await s.commit()
        await self.engine.dispose()

    def _entity(self, suffix: str, **fields) -> CatalogEntity:
        defaults = {
            "discipline": "overwatch",
            "kind": "character",
            "slug": f"{self.tag}-{suffix}",
            "name": f"{self.tag} {suffix}",
        }
        return CatalogEntity(**{**defaults, **fields})

    async def test_a_kind_outside_the_core_vocabulary_is_refused(self) -> None:
        async with self.Session() as s:
            s.add(self._entity("hero", kind="hero"))
            with self.assertRaises(IntegrityError):
                await s.flush()

    async def test_slug_and_name_are_unique_per_discipline_and_kind_only(self) -> None:
        async with self.Session() as s:
            s.add_all([self._entity("x"), self._entity("x", kind="map"), self._entity("x", discipline="lol")])
            await s.commit()
        async with self.Session() as s:
            s.add(self._entity("x"))
            with self.assertRaises(IntegrityError):
                await s.flush()

    async def test_a_parent_must_share_the_discipline(self) -> None:
        async with self.Session() as s:
            mode = self._entity("mode", kind="mode")
            s.add(mode)
            await s.commit()
        async with self.Session() as s:
            s.add(self._entity("map", kind="map", discipline="lol", parent_id=mode.id))
            with self.assertRaises(IntegrityError):
                await s.flush()

    async def test_a_scoped_repository_never_returns_another_kind_or_discipline(self) -> None:
        async with self.Session() as s:
            hero = self._entity("ana")
            ow_map = self._entity("ana", kind="map")
            champion = self._entity("ana", discipline="lol")
            s.add_all([hero, ow_map, champion])
            await s.commit()
            repo = CatalogEntityRepository("character", discipline="overwatch")
            assert await repo.get(s, ow_map.id) is None
            assert await repo.get(s, champion.id) is None
            assert (await repo.get(s, hero.id)).id == hero.id
            found = await repo.get_many_by(s, CatalogEntity.slug, [f"{self.tag}-ana"])
            assert [entity.id for entity in found.values()] == [hero.id]

    async def test_count_and_exists_obey_the_repository_scope(self) -> None:
        async with self.Session() as s:
            hero = self._entity("ana")
            ow_map = self._entity("ana", kind="map")
            champion = self._entity("ana", discipline="lol")
            s.add_all([hero, ow_map, champion])
            await s.commit()
            repo = CatalogEntityRepository("character", discipline="overwatch")
            same_slug = [CatalogEntity.slug == f"{self.tag}-ana"]
            assert await repo.count(s, filters=same_slug) == 1
            assert await repo.exists(s, filters=same_slug)
            assert await repo.exists(s, id=hero.id)
            assert not await repo.exists(s, id=ow_map.id)
            assert not await repo.exists(s, filters=[CatalogEntity.id == champion.id])

    async def test_lookup_is_scoped_and_name_ordered(self) -> None:
        async with self.Session() as s:
            ana = self._entity("ana")
            rein = self._entity("rein")
            ow_map = self._entity("ana", kind="map")
            champion = self._entity("ana", discipline="lol")
            s.add_all([rein, ana, ow_map, champion])
            await s.commit()
            rows = await CatalogEntityRepository("character", discipline="overwatch").list_lookup(s)
            assert [name for _, name in rows] == sorted(name for _, name in rows)
            assert [(id, name) for id, name in rows if name.startswith(self.tag)] == [
                (ana.id, ana.name),
                (rein.id, rein.name),
            ]

    async def test_gamemode_expansion_loads_the_map_parent(self) -> None:
        async with self.Session() as s:
            mode = self._entity("mode", kind="mode")
            s.add(mode)
            await s.flush()
            map_entity = self._entity("map", kind="map", parent_id=mode.id)
            s.add(map_entity)
            await s.commit()
            map_id, mode_id = map_entity.id, mode.id
        async with self.Session() as s:
            repo = CatalogEntityRepository("map", discipline="overwatch")
            assert repo.load_options(()) == []
            loaded = await repo.get(s, map_id, options=repo.load_options(("gamemode",)))
            assert loaded.parent.id == mode_id
