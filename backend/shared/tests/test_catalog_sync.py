"""The shared half of every catalog sync and the two module sources (D85). DB tests need the test Postgres."""

from __future__ import annotations

import asyncio
import itertools
import os
import sys
from unittest import IsolatedAsyncioTestCase

import pytest
import sqlalchemy as sa
from sqlalchemy.ext.asyncio import async_sessionmaker

from shared.catalog_sync import CatalogImageMirror, SourceEntity, apply_source, merge_aliases
from shared.disciplines import DISCIPLINES
from shared.disciplines.lol import catalog_sync as lol_sync
from shared.disciplines.overwatch import catalog_sync as overwatch_sync
from shared.models.catalog.entity import CatalogEntity
from shared.testing import create_test_async_engine
from shared.testing.db import ensure_test_postgres

BUCKET = "https://bucket/"
_TAG = itertools.count()


class _S3:
    def __init__(self) -> None:
        self.keys: list[str] = []

    def get_public_url(self, key: str) -> str:
        return f"{BUCKET}{key}"

    async def put_object(self, key: str, data: bytes, content_type: str, *, public: bool) -> bool:
        self.keys.append(key)
        return True


class _Response:
    def __init__(self, payload=None, *, content_type: str = "application/json") -> None:
        self.payload = payload
        self.headers = {"content-type": content_type}
        self.content = b"img"

    def raise_for_status(self) -> None:
        return None

    def json(self):
        return self.payload


class _Http:
    """Routes a path to a payload; any absolute URL is an image."""

    def __init__(self, routes: dict, *, image_type: str = "image/png") -> None:
        self.routes = routes
        self.image_type = image_type
        self.paths: list[str] = []

    async def get(self, path: str, **_: object) -> _Response:
        self.paths.append(path)
        if path.startswith("http"):
            return _Response(content_type=self.image_type)
        return _Response(self.routes[path])


def test_the_mirror_keeps_an_image_on_the_bucket_and_uploads_the_rest_by_discipline_and_kind() -> None:
    s3 = _S3()
    http = _Http({})
    urls = asyncio.run(
        CatalogImageMirror(s3).resolve_many(
            http,
            discipline="lol",
            kind="character",
            images={"ahri": (f"{BUCKET}keep.png", "https://src/ahri.PNG"), "annie": (None, "https://src/annie.png")},
        )
    )
    assert urls == {"ahri": f"{BUCKET}keep.png", "annie": f"{BUCKET}assets/lol/character/annie.png"}
    assert s3.keys == ["assets/lol/character/annie.png"]
    assert http.paths == ["https://src/annie.png"]


def test_the_mirror_refuses_a_page_that_is_not_an_image() -> None:
    with pytest.raises(ValueError, match="not an image"):
        asyncio.run(
            CatalogImageMirror(_S3()).resolve_many(
                _Http({}, image_type="text/html"), discipline="lol", kind="map", images={"x": (None, "https://src/x")}
            )
        )


def test_the_mirror_propagates_an_upload_failure() -> None:
    class _FailingS3(_S3):
        async def put_object(self, key: str, data: bytes, content_type: str, *, public: bool) -> bool:
            return False

    with pytest.raises(RuntimeError, match="S3 upload failed"):
        asyncio.run(
            CatalogImageMirror(_FailingS3()).resolve_many(
                _Http({}), discipline="overwatch", kind="map", images={"x": (None, "https://src/x.PNG")}
            )
        )


def test_alias_merge_keeps_manual_names_and_sorts_a_deduplicated_union_without_the_canonical_name() -> None:
    assert merge_aliases(existing=["Ana-hand", "Ана", "Ana"], localized=["Ана", "アナ", "Ana"], canonical="Ana") == [
        "Ana-hand",
        "Ана",
        "アナ",
    ]
    assert merge_aliases(existing=[], localized=[], canonical="Ana") == []


def test_every_registered_module_brings_its_sync() -> None:
    assert DISCIPLINES["overwatch"].catalog_sync is not None
    assert DISCIPLINES["lol"].catalog_sync is not None


class CatalogSyncDbTests(IsolatedAsyncioTestCase):
    if sys.platform == "win32":
        loop_factory = asyncio.SelectorEventLoop

    async def asyncSetUp(self) -> None:
        ensure_test_postgres()
        self.engine = create_test_async_engine()
        self.Session = async_sessionmaker(self.engine, expire_on_commit=False)
        self.tag = f"sync{os.getpid()}x{next(_TAG)}"

    async def asyncTearDown(self) -> None:
        async with self.Session() as s:
            mine = sa.or_(CatalogEntity.slug.like(f"{self.tag}%"), CatalogEntity.name.like(f"{self.tag}%"))
            await s.execute(sa.delete(CatalogEntity).where(mine, CatalogEntity.parent_id.is_not(None)))
            await s.execute(sa.delete(CatalogEntity).where(mine))
            await s.commit()
        await self.engine.dispose()

    async def _rows(self, discipline: str, kind: str) -> list[tuple]:
        async with self.Session() as s:
            result = await s.execute(
                sa.select(
                    CatalogEntity.slug,
                    CatalogEntity.name,
                    CatalogEntity.image_path,
                    CatalogEntity.attrs,
                    CatalogEntity.aliases,
                )
                .where(
                    CatalogEntity.discipline == discipline,
                    CatalogEntity.kind == kind,
                    CatalogEntity.slug.like(f"{self.tag}%"),
                )
                .order_by(CatalogEntity.slug)
            )
            return [tuple(row) for row in result.all()]

    async def test_an_existing_row_keeps_its_name_and_class_and_gains_aliases(self) -> None:
        async with self.Session() as s:
            s.add(
                CatalogEntity(
                    discipline="overwatch",
                    kind="character",
                    slug=f"{self.tag}-ana",
                    name=f"{self.tag} Ana (edited)",
                    attrs={"class": "support"},
                    aliases=["Ana-hand"],
                    image_path=f"{BUCKET}kept.png",
                )
            )
            await s.commit()
        rows = [
            SourceEntity(
                slug=f"{self.tag}-ana",
                name=f"{self.tag} Ana",
                image_url="https://src/ana.png",
                attrs={"class": "damage"},
                aliases=("Ана",),
            ),
            SourceEntity(
                slug=f"{self.tag}-rein",
                name=f"{self.tag} Rein",
                image_url="https://src/rein.png",
                attrs={"class": "tank"},
            ),
        ]
        async with self.Session() as s:
            created = await apply_source(
                s, _Http({}), CatalogImageMirror(_S3()), discipline="overwatch", kind="character", rows=rows
            )
        assert created == 1
        assert await self._rows("overwatch", "character") == [
            (
                f"{self.tag}-ana",
                f"{self.tag} Ana (edited)",
                f"{BUCKET}kept.png",
                {"class": "support"},
                ["Ana-hand", "Ана"],
            ),
            (
                f"{self.tag}-rein",
                f"{self.tag} Rein",
                f"{BUCKET}assets/overwatch/character/{self.tag}-rein.png",
                {"class": "tank"},
                [],
            ),
        ]

    async def test_overfast_brings_modes_then_maps_under_them_then_heroes_with_every_locale(self) -> None:
        tag = self.tag
        routes = {
            "/gamemodes": [
                {
                    "key": f"{tag}-control",
                    "name": f"{tag} Control",
                    "icon": "https://of/control.svg",
                    "description": "Capture",
                    "screenshot": "x",
                }
            ],
            f"/maps?gamemode={tag}-control": [
                {
                    "name": f"{tag} Ilios",
                    "screenshot": "https://of/ilios.jpg",
                    "gamemodes": [],
                    "location": "",
                    "country_code": None,
                }
            ],
            f"/heroes?locale={overwatch_sync.CANONICAL_LOCALE}": [
                {"key": f"{tag}-ana", "name": f"{tag} Ana", "portrait": "https://of/ana.png", "role": "support"}
            ],
            **{
                f"/heroes?locale={locale}": [
                    {"key": f"{tag}-ana", "name": f"{tag} Ana {locale}", "portrait": "x", "role": "support"}
                ]
                for locale in overwatch_sync.ALIAS_LOCALES
            },
        }
        http = _Http(routes)
        async with self.Session() as s:
            await overwatch_sync.sync_catalog(s, CatalogImageMirror(_S3()), http=http)
        (mode,) = await self._rows("overwatch", "mode")
        assert mode[3] == {"description": "Capture"}
        async with self.Session() as s:
            ilios = await s.scalar(sa.select(CatalogEntity).where(CatalogEntity.slug == f"{tag}-ilios"))
            control = await s.scalar(sa.select(CatalogEntity).where(CatalogEntity.slug == f"{tag}-control"))
        assert ilios.parent_id == control.id and ilios.kind == "map"
        assert ilios.attrs == {"in_competitive": True}
        (hero,) = await self._rows("overwatch", "character")
        assert hero[3] == {"class": "support"}
        assert hero[4] == sorted(f"{tag} Ana {locale}" for locale in overwatch_sync.ALIAS_LOCALES)
        for locale in (overwatch_sync.CANONICAL_LOCALE, *overwatch_sync.ALIAS_LOCALES):
            assert http.paths.count(f"/heroes?locale={locale}") == 1

    async def test_overfast_existing_maps_keep_admin_attrs_and_parent_and_new_maps_are_competitive(self) -> None:
        tag = self.tag
        async with self.Session() as s:
            mode = CatalogEntity(discipline="overwatch", kind="mode", slug=f"{tag}-edited", name=f"{tag} Edited")
            s.add(mode)
            await s.flush()
            s.add(
                CatalogEntity(
                    discipline="overwatch",
                    kind="map",
                    slug=f"{tag}-ilios",
                    name=f"{tag} Ilios (edited)",
                    attrs={"in_competitive": False, "custom": "kept"},
                    parent_id=mode.id,
                    image_path=f"{BUCKET}edited.jpg",
                )
            )
            s.add(
                CatalogEntity(
                    discipline="overwatch",
                    kind="map",
                    slug=f"{tag}-oasis",
                    name=f"{tag} Oasis",
                    attrs={},
                    image_path=f"{BUCKET}oasis.jpg",
                )
            )
            await s.commit()
            parent_id = mode.id
        routes = {
            "/gamemodes": [
                {
                    "key": f"{tag}-control",
                    "name": f"{tag} Control",
                    "icon": "https://of/control.svg",
                    "description": "Capture",
                },
                {
                    "key": f"{tag}-hybrid",
                    "name": f"{tag} Hybrid",
                    "icon": "https://of/hybrid.svg",
                    "description": "Escort",
                },
            ],
            f"/maps?gamemode={tag}-control": [
                {"name": f"{tag} Ilios", "screenshot": "https://of/ilios.jpg"},
                {"name": f"{tag} Nepal", "screenshot": "https://of/nepal.jpg"},
                {"name": f"{tag} Oasis", "screenshot": "https://of/oasis.jpg"},
            ],
            f"/maps?gamemode={tag}-hybrid": [{"name": f"{tag} Nepal", "screenshot": "https://of/nepal-alt.jpg"}],
            **{
                f"/heroes?locale={locale}": []
                for locale in (overwatch_sync.CANONICAL_LOCALE, *overwatch_sync.ALIAS_LOCALES)
            },
        }
        async with self.Session() as s:
            await overwatch_sync.sync_catalog(s, CatalogImageMirror(_S3()), http=_Http(routes))
            ilios = await s.scalar(sa.select(CatalogEntity).where(CatalogEntity.slug == f"{tag}-ilios"))
            nepal = await s.scalar(sa.select(CatalogEntity).where(CatalogEntity.slug == f"{tag}-nepal"))
            oasis = await s.scalar(sa.select(CatalogEntity).where(CatalogEntity.slug == f"{tag}-oasis"))
            control = await s.scalar(sa.select(CatalogEntity).where(CatalogEntity.slug == f"{tag}-control"))
        assert ilios.name == f"{tag} Ilios (edited)"
        assert ilios.attrs == {"in_competitive": False, "custom": "kept"}
        assert ilios.parent_id == parent_id
        assert ilios.image_path == f"{BUCKET}edited.jpg"
        assert nepal.attrs == {"in_competitive": True}
        assert nepal.parent_id == control.id
        assert nepal.image_path == f"{BUCKET}assets/overwatch/map/{tag}-nepal.jpg"
        assert oasis.attrs == {}
        assert oasis.parent_id == control.id

    async def test_data_dragon_brings_champions_and_maps_without_modes(self) -> None:
        tag = self.tag
        routes = {
            "/api/versions.json": ["14.1.1", "14.0.0"],
            "/cdn/14.1.1/data/en_US/champion.json": {
                "data": {
                    f"{tag}MonkeyKing": {
                        "id": f"{tag}MonkeyKing",
                        "name": f"{tag} Wukong",
                        "tags": ["Fighter", "Tank"],
                        "image": {"full": "MonkeyKing.png"},
                    },
                    f"{tag}Ahri": {
                        "id": f"{tag}Ahri",
                        "name": f"{tag}Ahri",
                        "tags": ["Mage"],
                        "image": {"full": "Ahri.png"},
                    },
                }
            },
            "/cdn/14.1.1/data/en_US/map.json": {
                "data": {
                    "11": {"MapName": f"{tag} Rift", "MapId": "11", "image": {"full": "map11.png"}},
                    "12": {"MapName": f"{tag} Abyss", "MapId": "12", "image": {"full": "map12.png"}},
                    "21": {"MapName": f"{tag} Rift", "MapId": "21", "image": {"full": "map21.png"}},
                }
            },
        }
        s3 = _S3()
        http = _Http(routes)
        async with self.Session() as s:
            await lol_sync.sync_catalog(s, CatalogImageMirror(s3), http=http)
        champions = await self._rows("lol", "character")
        assert [(slug, attrs, aliases) for slug, _n, _i, attrs, aliases in champions] == [
            (f"{tag}ahri", {"class": "Mage"}, []),
            (f"{tag}monkeyking", {"class": "Fighter"}, [f"{tag}MonkeyKing"]),
        ]
        maps = await self._rows("lol", "map")
        assert [slug for slug, *_ in maps] == [f"{tag}-abyss", f"{tag}-rift"]
        assert f"assets/lol/map/{tag}-rift.png" in s3.keys
        assert f"{lol_sync.DATA_DRAGON}/cdn/14.1.1/img/map/map11.png" in http.paths
        assert f"{lol_sync.DATA_DRAGON}/cdn/14.1.1/img/map/map21.png" not in http.paths
        assert await self._rows("lol", "mode") == []
