"""The public native catalog reads (P7 §3.2) against real PostgreSQL: scoping by discipline and kind, the active
default, the same-shape parent, and the error codes. Rows are created per test; no legacy or fixture id is assumed."""

from __future__ import annotations

import asyncio
import sys
import uuid
from contextlib import asynccontextmanager
from unittest import IsolatedAsyncioTestCase

from sqlalchemy.ext.asyncio import AsyncSession

from shared import models
from shared.testing import create_test_async_engine, ensure_test_postgres
from src.rpc import catalog as catalog_rpc
from tests.conftest import RpcHarness, build_query


def _error_code(reply: dict) -> str:
    return reply["error"]["details"]["fields"][0]["code"]


class PublicCatalogTests(IsolatedAsyncioTestCase):
    if sys.platform == "win32":
        loop_factory = asyncio.SelectorEventLoop  # psycopg async cannot run on the Proactor loop

    async def asyncSetUp(self) -> None:
        ensure_test_postgres()
        self.engine = create_test_async_engine()
        self.connection = await self.engine.connect()
        self.transaction = await self.connection.begin()
        self.session = AsyncSession(self.connection, expire_on_commit=False, join_transaction_mode="create_savepoint")
        self.tag = uuid.uuid4().hex[:10]

        self.control = self.entity("overwatch", "mode", "control")
        await self.session.flush()  # the map's parent_id needs the mode's id
        self.ana = self.entity("overwatch", "character", "ana", attrs={"class": "support"})
        self.retired = self.entity("overwatch", "character", "old", attrs={"class": "tank"}, active=False)
        self.ahri = self.entity("lol", "character", "ahri", attrs={"class": "Mage"}, aliases=["Ари"])
        self.ilios = self.entity("overwatch", "map", "ilios", parent=self.control, attrs={"in_competitive": True})
        self.rift = self.entity("lol", "map", "rift")
        await self.session.flush()

        @asynccontextmanager
        async def _factory():  # the handler's own session is this rolled-back one
            yield self.session

        self._original = catalog_rpc._SF
        catalog_rpc._SF = _factory
        self.rpc = RpcHarness().register(catalog_rpc)

    async def asyncTearDown(self) -> None:
        catalog_rpc._SF = self._original
        await self.session.close()
        await self.transaction.rollback()
        await self.connection.close()
        await self.engine.dispose()

    def entity(
        self,
        discipline: str,
        kind: str,
        slug: str,
        *,
        parent: models.CatalogEntity | None = None,
        attrs: dict | None = None,
        active: bool = True,
        aliases: list[str] | None = None,
    ) -> models.CatalogEntity:
        row = models.CatalogEntity(
            discipline=discipline,
            kind=kind,
            slug=f"{self.tag}-{slug}",
            name=f"{self.tag}-{slug}",
            attrs=attrs or {},
            aliases=aliases or [],
            active=active,
            parent_id=None if parent is None else parent.id,
        )
        self.session.add(row)
        return row

    async def list(self, discipline: str, kind: str, **query: object) -> dict:
        data = {"discipline": discipline, "kind": kind, "query": build_query({"per_page": 500, **query})}
        return await self.rpc.call("rpc.app.catalog.list", data)

    async def get(self, discipline: str, kind: str, entity_id: int) -> dict:
        return await self.rpc.call("rpc.app.catalog.get", {"discipline": discipline, "kind": kind, "id": entity_id})

    async def slugs(self, discipline: str, kind: str, **query: object) -> set[str]:
        reply = await self.list(discipline, kind, **query)
        self.assertTrue(reply["ok"], reply)
        return {row["slug"] for row in reply["data"]["results"] if row["slug"].startswith(self.tag)}

    async def test_each_discipline_lists_only_its_own_rows_of_the_kind(self) -> None:
        self.assertEqual({self.ana.slug}, await self.slugs("overwatch", "character"))
        self.assertEqual({self.ahri.slug}, await self.slugs("lol", "character"))
        self.assertEqual({self.ilios.slug}, await self.slugs("overwatch", "map"))
        self.assertEqual({self.rift.slug}, await self.slugs("lol", "map"))

    async def test_a_public_list_defaults_to_active_rows_and_active_false_asks_for_retired_ones(self) -> None:
        self.assertNotIn(self.retired.slug, await self.slugs("overwatch", "character"))
        self.assertEqual({self.retired.slug}, await self.slugs("overwatch", "character", active=False))

    async def test_the_wire_is_the_shared_entity_read_with_aliases_and_discipline(self) -> None:
        reply = await self.list("lol", "character", search=self.ahri.slug)

        (row,) = reply["data"]["results"]
        self.assertEqual("lol", row["discipline"])
        self.assertEqual("character", row["kind"])
        self.assertEqual(["Ари"], row["aliases"])
        self.assertEqual({"class": "Mage"}, row["attrs"])
        self.assertIsNone(row["parent"])
        self.assertEqual(
            {"results", "total", "page", "per_page"}, set(reply["data"]) & {"results", "total", "page", "per_page"}
        )

    async def test_filtering_a_map_by_its_mode_and_by_attrs_stays_in_the_discipline(self) -> None:
        by_mode = await self.slugs("overwatch", "map", parent_id=self.control.id)
        self.assertEqual({self.ilios.slug}, by_mode)
        by_attrs = await self.slugs("overwatch", "map", attrs='{"in_competitive": true}')
        self.assertEqual({self.ilios.slug}, by_attrs)
        self.assertEqual(set(), await self.slugs("overwatch", "map", attrs='{"in_competitive": false}'))

    async def test_a_kind_the_game_does_not_declare_is_404_catalog_kind_not_declared(self) -> None:
        reply = await self.list("lol", "mode")

        self.assertFalse(reply["ok"])
        self.assertEqual("not_found", reply["error"]["code"])
        self.assertEqual("catalog_kind_not_declared", _error_code(reply))
        detail = await self.get("lol", "mode", self.control.id)
        self.assertEqual("catalog_kind_not_declared", _error_code(detail))

    async def test_an_uninstalled_discipline_or_kind_is_a_404_never_overwatch(self) -> None:
        for discipline in ("chess", "OVERWATCH", ""):
            reply = await self.list(discipline, "character")
            self.assertEqual("not_found", reply["error"]["code"], discipline)
            self.assertEqual("discipline_not_installed", _error_code(reply), discipline)
        reply = await self.list("overwatch", "hero")
        self.assertEqual("catalog_kind_not_declared", _error_code(reply))

    async def test_an_invalid_attrs_filter_is_422(self) -> None:
        reply = await self.list("overwatch", "character", attrs="[1]")

        self.assertFalse(reply["ok"])
        self.assertEqual("unprocessable", reply["error"]["code"])

    async def test_detail_expands_the_parent_in_the_same_shape_and_serves_inactive_rows(self) -> None:
        reply = await self.get("overwatch", "map", self.ilios.id)

        self.assertTrue(reply["ok"], reply)
        data = reply["data"]
        self.assertEqual(self.control.id, data["parent_id"])
        self.assertEqual(self.control.id, data["parent"]["id"])
        self.assertEqual({"mode"}, {data["parent"]["kind"]})
        self.assertEqual(set(data) - {"parent"}, set(data["parent"]) - {"parent"})
        self.assertIsNone(data["parent"]["parent"])
        retired = await self.get("overwatch", "character", self.retired.id)
        self.assertTrue(retired["ok"], retired)
        self.assertFalse(retired["data"]["active"])

    async def test_an_id_of_another_discipline_or_kind_is_404_not_a_relabelled_entity(self) -> None:
        for discipline, kind, entity in (
            ("overwatch", "character", self.ahri),  # another game's champion
            ("lol", "character", self.ana),  # another game's hero
            ("overwatch", "map", self.ana),  # another kind
            ("overwatch", "character", self.ilios),
            ("lol", "map", self.ilios),
        ):
            reply = await self.get(discipline, kind, entity.id)
            self.assertFalse(reply["ok"], (discipline, kind))
            self.assertEqual("not_found", reply["error"]["code"], (discipline, kind))

    async def test_a_missing_id_is_not_found(self) -> None:
        reply = await self.get("overwatch", "character", 2_000_000_000)

        self.assertEqual("not_found", reply["error"]["code"])
        self.assertEqual("not_found", _error_code(reply))
