"""The shared half of every catalog sync and the two module sources (D85). DB tests need the test Postgres."""

from __future__ import annotations

import asyncio
import copy
import itertools
import os
import sys
from unittest import IsolatedAsyncioTestCase

import pytest
import sqlalchemy as sa
from sqlalchemy.ext.asyncio import async_sessionmaker

from shared.catalog_sync import CatalogImageMirror, CatalogSyncProgress, SourceEntity, apply_source, merge_aliases
from shared.core.errors import ApiHTTPException
from shared.disciplines import DISCIPLINES
from shared.disciplines.lol import catalog_sync as lol_sync
from shared.disciplines.overwatch import catalog_sync as overwatch_sync
from shared.models.catalog.entity import CatalogEntity
from shared.repository import CatalogEntityRepository
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


def _progress(snapshots: list | None = None, kinds=("mode", "map", "character")) -> CatalogSyncProgress:
    """A progress over ``kinds``; ``snapshots`` collects ``(source, stages)`` after each change."""

    async def record(progress: CatalogSyncProgress) -> None:
        if snapshots is not None:
            snapshots.append((progress.source, copy.deepcopy(list(progress.stages.values()))))

    return CatalogSyncProgress(kinds, record)


def _stage(key: str, state: str, done: int | None = None, total: int | None = None, created: int | None = None):
    return {"key": key, "state": state, "done": done, "total": total, "created": created}


def test_the_mirror_keeps_an_image_on_the_bucket_and_uploads_the_rest_by_discipline_and_kind() -> None:
    s3 = _S3()
    http = _Http({})
    snapshots: list = []
    urls = asyncio.run(
        CatalogImageMirror(s3).resolve_many(
            http,
            _progress(snapshots),
            discipline="lol",
            kind="character",
            images={"ahri": (f"{BUCKET}keep.png", "https://src/ahri.PNG"), "annie": (None, "https://src/annie.png")},
        )
    )
    assert urls == {"ahri": f"{BUCKET}keep.png", "annie": f"{BUCKET}assets/lol/character/annie.png"}
    assert s3.keys == ["assets/lol/character/annie.png"]
    assert http.paths == ["https://src/annie.png"]
    # The counter covers the one download, not the image already on the bucket.
    assert [stages[3] for _source, stages in snapshots] == [
        _stage("character", "pending", done=0, total=1),
        _stage("character", "pending", done=1, total=1),
    ]


def test_the_mirror_refuses_a_page_that_is_not_an_image() -> None:
    with pytest.raises(ValueError, match="not an image"):
        asyncio.run(
            CatalogImageMirror(_S3()).resolve_many(
                _Http({}, image_type="text/html"),
                _progress(),
                discipline="lol",
                kind="map",
                images={"x": (None, "https://src/x")},
            )
        )


def test_the_mirror_propagates_an_upload_failure() -> None:
    class _FailingS3(_S3):
        async def put_object(self, key: str, data: bytes, content_type: str, *, public: bool) -> bool:
            return False

    with pytest.raises(RuntimeError, match="S3 upload failed"):
        asyncio.run(
            CatalogImageMirror(_FailingS3()).resolve_many(
                _Http({}), _progress(), discipline="overwatch", kind="map", images={"x": (None, "https://src/x.PNG")}
            )
        )


def test_a_failed_download_stops_the_others_before_it_surfaces() -> None:
    """A download still running after the failure would report on top of the sync's verdict, as if it went on."""
    snapshots: list = []
    s3 = _S3()

    async def scenario() -> None:
        gate = asyncio.Event()

        class _Http2(_Http):
            async def get(self, path: str, **_: object) -> _Response:
                if path.endswith("bad"):
                    raise RuntimeError("boom")
                await gate.wait()
                return await super().get(path)

        with pytest.raises(RuntimeError, match="boom"):
            await CatalogImageMirror(s3).resolve_many(
                _Http2({}),
                _progress(snapshots),
                discipline="overwatch",
                kind="map",
                images={"good": (None, "https://src/good.png"), "bad": (None, "https://src/bad")},
            )
        gate.set()
        await asyncio.sleep(0.01)

    asyncio.run(scenario())
    assert s3.keys == []
    assert [stages[2] for _source, stages in snapshots] == [_stage("map", "pending", done=0, total=2)]


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


def test_the_stages_follow_the_source_in_sync_order_and_a_failure_marks_the_first_unfinished_one() -> None:
    assert list(_progress(kinds=DISCIPLINES["overwatch"].kinds).stages) == ["source", "mode", "map", "character"]
    progress = _progress(kinds=DISCIPLINES["lol"].kinds)
    assert list(progress.stages.values()) == [  # LoL has no modes; the source runs from the start
        _stage("source", "running"),
        _stage("map", "pending"),
        _stage("character", "pending"),
    ]

    async def map_done() -> None:
        await progress.begin("map")
        await progress.finish("map", 3)

    asyncio.run(map_done())
    progress.fail()
    assert list(progress.stages.values()) == [
        _stage("source", "done"),
        _stage("map", "done", created=3),
        _stage("character", "failed"),
    ]


class CatalogSyncDbTests(IsolatedAsyncioTestCase):
    if sys.platform == "win32":
        loop_factory = asyncio.SelectorEventLoop

    async def asyncSetUp(self) -> None:
        ensure_test_postgres()
        self.engine = create_test_async_engine()
        self.Session = async_sessionmaker(self.engine, expire_on_commit=False)
        self.tag = f"sync{os.getpid()}x{next(_TAG)}"
        await self._clear_summoners_rift()

    async def asyncTearDown(self) -> None:
        async with self.Session() as s:
            mine = sa.or_(CatalogEntity.slug.like(f"{self.tag}%"), CatalogEntity.name.like(f"{self.tag}%"))
            await s.execute(sa.delete(CatalogEntity).where(mine, CatalogEntity.parent_id.is_not(None)))
            await s.execute(sa.delete(CatalogEntity).where(mine))
            await s.commit()
        await self._clear_summoners_rift()
        await self.engine.dispose()

    async def _clear_summoners_rift(self) -> None:
        # Data Dragon map 11's code is fixed, not tagged: whichever test (or crashed run) left it goes. Test DB only.
        fixed = sa.select(CatalogEntity.id).where(
            CatalogEntity.discipline == "lol",
            CatalogEntity.kind == "map",
            CatalogEntity.slug == "summoners_rift",
        )
        async with self.Session() as s:
            await s.execute(sa.delete(CatalogEntity).where(CatalogEntity.parent_id.in_(fixed)))
            await s.execute(sa.delete(CatalogEntity).where(CatalogEntity.id.in_(fixed)))
            await s.commit()

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

    async def test_bad_source_attrs_reject_the_batch_before_writing_or_mirroring(self) -> None:
        cases = (
            ("overwatch", "character", {}),
            ("overwatch", "character", {"class": "flex"}),
            ("overwatch", "character", {"class": ["tank"]}),
            ("lol", "character", {"class": "tank"}),
            ("overwatch", "character", {"class": "support", "color": None}),
            ("overwatch", "character", {"class": "support", "color": 123}),
            ("overwatch", "map", {"in_competitive": None}),
            ("overwatch", "map", {"in_competitive": "false"}),
            ("overwatch", "map", {"in_competitive": 1}),
        )
        for discipline, kind, attrs in cases:
            with self.subTest(discipline=discipline, kind=kind, attrs=attrs):
                http, s3 = _Http({}), _S3()
                valid = {"class": "support"} if kind == "character" else {"in_competitive": True}
                if discipline == "lol":
                    valid = {"class": "Mage"}
                rows = [
                    SourceEntity(
                        slug=f"{self.tag}-good", name=f"{self.tag} Good", image_url="https://src/good", attrs=valid
                    ),
                    SourceEntity(
                        slug=f"{self.tag}-bad", name=f"{self.tag} Bad", image_url="https://src/bad", attrs=attrs
                    ),
                ]
                async with self.Session() as session:
                    with self.assertRaisesRegex(ValueError, "attrs[.]"):
                        await apply_source(
                            session,
                            http,
                            CatalogImageMirror(s3),
                            _progress(),
                            discipline=discipline,
                            kind=kind,
                            rows=rows,
                        )
                assert await self._rows(discipline, kind) == []
                assert http.paths == [] and s3.keys == []

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
        snapshots: list = []
        async with self.Session() as s:
            created = await apply_source(
                s,
                _Http({}),
                CatalogImageMirror(_S3()),
                _progress(snapshots),
                discipline="overwatch",
                kind="character",
                rows=rows,
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
        # The kind's stage: running from the start, then the one download Rein needs (Ana's image is already ours),
        # then done with what it created. The source is done once a kind writes; the other kinds never started.
        source, mode, game_map = _stage("source", "done"), _stage("mode", "pending"), _stage("map", "pending")
        assert [stages for _source, stages in snapshots] == [
            [source, mode, game_map, _stage("character", "running")],
            [source, mode, game_map, _stage("character", "running", done=0, total=1)],
            [source, mode, game_map, _stage("character", "running", done=1, total=1)],
            [source, mode, game_map, _stage("character", "done", done=1, total=1, created=1)],
        ]

    async def test_sync_finds_an_entity_after_an_admin_changes_its_slug(self) -> None:
        source = SourceEntity(
            slug=f"{self.tag}-ana",
            name=f"{self.tag} Ana",
            image_url="https://src/ana.png",
            attrs={"class": "support"},
            aliases=("Ана",),
        )
        repo = CatalogEntityRepository("character", discipline="overwatch")
        async with self.Session() as s:
            assert (
                await apply_source(
                    s,
                    _Http({}),
                    CatalogImageMirror(_S3()),
                    _progress(),
                    discipline="overwatch",
                    kind="character",
                    rows=[source],
                )
                == 1
            )
            current = await repo.get_by(s, name=source.name)
            entity_id = current.id
            await repo.update_fields(
                s,
                current,
                {
                    "slug": f"{self.tag}-ana-edited",
                    "aliases": [*current.aliases, "Ana-hand"],
                    "image_path": f"{BUCKET}edited.png",
                },
            )
            await s.commit()
        updated_source = SourceEntity(
            slug=source.slug,
            name=source.name,
            image_url=source.image_url,
            attrs={"class": "damage"},
            aliases=("아나",),
        )
        async with self.Session() as s:
            created = await apply_source(
                s,
                _Http({}),
                CatalogImageMirror(_S3()),
                _progress(),
                discipline="overwatch",
                kind="character",
                rows=[updated_source],
            )
            current = await repo.get_by(s, name=source.name)
            assert current.id == entity_id
        assert created == 0
        assert await self._rows("overwatch", "character") == [
            (
                f"{self.tag}-ana-edited",
                source.name,
                f"{BUCKET}edited.png",
                {"class": "support"},
                ["Ana-hand", "Ана", "아나"],
            )
        ]

    async def test_overfast_brings_modes_then_maps_under_them_then_heroes_with_every_locale(self) -> None:
        tag = self.tag
        locales = (
            "en-us",
            "de-de",
            "en-gb",
            "es-es",
            "es-mx",
            "fr-fr",
            "it-it",
            "ja-jp",
            "ko-kr",
            "pl-pl",
            "pt-br",
            "ru-ru",
            "zh-tw",
        )
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
            "/heroes?locale=en-us": [
                {"key": f"{tag}-ana", "name": f"{tag} Ana", "portrait": "https://of/ana.png", "role": "support"}
            ],
            **{
                f"/heroes?locale={locale}": [
                    {"key": f"{tag}-ana", "name": f"{tag} Ana {locale}", "portrait": "x", "role": "support"}
                ]
                for locale in locales[1:]
            },
        }
        http = _Http(routes)
        async with self.Session() as s:
            await overwatch_sync.sync_catalog(s, CatalogImageMirror(_S3()), _progress(), http=http)
        (mode,) = await self._rows("overwatch", "mode")
        assert mode[3] == {"description": "Capture"}
        async with self.Session() as s:
            ilios = await s.scalar(sa.select(CatalogEntity).where(CatalogEntity.slug == f"{tag}-ilios"))
            control = await s.scalar(sa.select(CatalogEntity).where(CatalogEntity.slug == f"{tag}-control"))
        assert ilios.parent_id == control.id and ilios.kind == "map"
        assert ilios.attrs == {"in_competitive": True}
        (hero,) = await self._rows("overwatch", "character")
        assert hero[3] == {"class": "support"}
        assert hero[4] == sorted(f"{tag} Ana {locale}" for locale in locales[1:])
        assert {path for path in http.paths if path.startswith("/heroes?locale=")} == {
            f"/heroes?locale={locale}" for locale in locales
        }
        for locale in locales:
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
            await overwatch_sync.sync_catalog(s, CatalogImageMirror(_S3()), _progress(), http=_Http(routes))
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
                    "453": {"MapName": " ", "MapId": "453", "image": {"full": "map453.png"}},
                }
            },
        }
        s3 = _S3()
        http = _Http(routes)
        async with self.Session() as s:
            await lol_sync.sync_catalog(s, CatalogImageMirror(s3), _progress(), http=http)
        champions = await self._rows("lol", "character")
        assert [(slug, attrs, aliases) for slug, _n, _i, attrs, aliases in champions] == [
            (f"{tag}ahri", {"class": "Mage"}, []),
            (f"{tag}monkeyking", {"class": "Fighter"}, [f"{tag}MonkeyKing"]),
        ]
        maps = await self._rows("lol", "map")
        # Map 11 takes the fixed canonical code, which ``_rows`` (tagged slugs) cannot see: it is found by its name.
        assert [slug for slug, *_ in maps] == [f"{tag}-abyss"]
        rift = [(m.slug, m.image_path) for m in await self._lol_maps() if m.name == f"{tag} Rift"]
        assert rift == [("summoners_rift", f"{BUCKET}assets/lol/map/summoners_rift.png")]
        assert "assets/lol/map/summoners_rift.png" in s3.keys
        assert f"{lol_sync.DATA_DRAGON}/cdn/14.1.1/img/map/map11.png" in http.paths
        assert f"{lol_sync.DATA_DRAGON}/cdn/14.1.1/img/map/map21.png" not in http.paths
        # A map id without a name (Data Dragon 16.20 lists 453 so) is skipped, image and all.
        assert f"{lol_sync.DATA_DRAGON}/cdn/14.1.1/img/map/map453.png" not in http.paths
        assert await self._rows("lol", "mode") == []

    # ── Data Dragon map 11 under its canonical code ``summoners_rift`` ──────────

    async def _lol_maps(self) -> list[CatalogEntity]:
        """This test's LoL maps: tagged by slug or name, plus the fixed canonical code ``_rows`` cannot see."""
        async with self.Session() as s:
            mine = sa.or_(
                CatalogEntity.slug == "summoners_rift",
                CatalogEntity.slug.like(f"{self.tag}%"),
                CatalogEntity.name.like(f"{self.tag}%"),
            )
            query = sa.select(CatalogEntity).where(CatalogEntity.discipline == "lol", CatalogEntity.kind == "map", mine)
            return list(await s.scalars(query.order_by(CatalogEntity.id)))

    async def _add_lol(self, slug: str, name: str, *, kind: str = "map", **fields: object) -> int:
        async with self.Session() as s:
            entity = CatalogEntity(discipline="lol", kind=kind, slug=slug, name=name, **fields)
            s.add(entity)
            await s.commit()
            return entity.id

    async def _sync_map11(
        self, http: _Http | None = None, s3: _S3 | None = None, progress: CatalogSyncProgress | None = None
    ) -> tuple[_Http, _S3]:
        http, s3 = http or _Http(_map11_routes(self.tag)), s3 or _S3()
        async with self.Session() as s:
            await lol_sync.sync_catalog(s, CatalogImageMirror(s3), progress or _progress(), http=http)
        return http, s3

    async def _assert_refused_unchanged(self, *ids: int) -> None:
        before = [_snapshot(m) for m in await self._lol_maps()]
        http, s3, progress = _Http(_map11_routes(self.tag)), _S3(), _progress(kinds=DISCIPLINES["lol"].kinds)
        with self.assertRaises(ApiHTTPException) as raised:
            await self._sync_map11(http, s3, progress)
        assert raised.exception.status_code == 409
        (error,) = raised.exception.detail
        assert error["code"] == "catalog_conflict"
        assert str(sorted(ids)) in error["msg"]
        # Refused before the map batch: no row changed, none added, no map image fetched or uploaded.
        assert [_snapshot(m) for m in await self._lol_maps()] == before
        assert s3.keys == []
        assert f"{lol_sync.DATA_DRAGON}/cdn/14.1.1/img/map/map11.png" not in http.paths
        # Inside the map stage, so a failure marks that stage, not the fetched source.
        progress.fail()
        assert [stage["state"] for stage in progress.stages.values()] == ["done", "failed", "pending"]

    async def _adopt_legacy(self, image_path: str) -> tuple[CatalogEntity, _Http, _S3]:
        """A row an earlier sync created under ``slugify(name)``, since edited by an admin and referenced by a child."""
        legacy_id = await self._add_lol(
            f"{self.tag}-rift", f"{self.tag} Rift", image_path=image_path, attrs={"custom": "kept"}, active=False
        )
        child_id = await self._add_lol(f"{self.tag}-child", f"{self.tag} Child", kind="character", parent_id=legacy_id)
        http, s3 = await self._sync_map11()
        (rift,) = await self._lol_maps()
        assert (rift.id, rift.slug, rift.name, rift.attrs, rift.active) == (
            legacy_id,
            "summoners_rift",
            f"{self.tag} Rift",
            {"custom": "kept"},
            False,
        )
        assert f"{self.tag}-rift" in rift.aliases
        async with self.Session() as s:
            assert await s.scalar(sa.select(CatalogEntity.parent_id).where(CatalogEntity.id == child_id)) == legacy_id
        return rift, http, s3

    async def test_map11_legacy_row_keeps_its_id_and_its_mirrored_image_under_the_canonical_code(self) -> None:
        mirrored = f"{BUCKET}assets/lol/map/{self.tag}-rift.png"
        rift, http, s3 = await self._adopt_legacy(mirrored)
        assert rift.image_path == mirrored
        assert s3.keys == []
        assert f"{lol_sync.DATA_DRAGON}/cdn/14.1.1/img/map/map11.png" not in http.paths

    async def test_map11_legacy_row_with_a_source_image_is_mirrored_under_the_canonical_code(self) -> None:
        rift, _http, s3 = await self._adopt_legacy("https://src/rift.png")
        assert rift.image_path == f"{BUCKET}assets/lol/map/summoners_rift.png"
        assert s3.keys == ["assets/lol/map/summoners_rift.png"]

    async def test_map11_repeat_sync_is_idempotent(self) -> None:
        await self._add_lol(f"{self.tag}-rift", f"{self.tag} Rift", image_path="https://src/rift.png")
        await self._sync_map11()
        first = [_snapshot(m) for m in await self._lol_maps()]
        _http, s3 = await self._sync_map11()
        assert [_snapshot(m) for m in await self._lol_maps()] == first
        assert [slug for _id, slug, *_ in first] == ["summoners_rift"]
        assert s3.keys == []

    async def test_map11_canonical_and_legacy_rows_together_are_a_conflict(self) -> None:
        canonical = await self._add_lol("summoners_rift", f"{self.tag} Canonical")
        legacy = await self._add_lol(f"{self.tag}-rift", f"{self.tag} Rift")
        await self._assert_refused_unchanged(canonical, legacy)

    async def test_map11_two_rows_aliasing_the_source_name_are_a_conflict(self) -> None:
        first = await self._add_lol(f"{self.tag}-a", f"{self.tag} A", aliases=[f"{self.tag} Rift"])
        second = await self._add_lol(f"{self.tag}-b", f"{self.tag} B", aliases=[f"{self.tag} Rift"])
        await self._assert_refused_unchanged(first, second)

    async def test_map11_row_found_by_name_keeps_an_admin_chosen_slug(self) -> None:
        custom = await self._add_lol(f"{self.tag}-custom", f"{self.tag} Rift", image_path=f"{BUCKET}custom.png")
        await self._sync_map11()
        (rift,) = await self._lol_maps()
        assert (rift.id, rift.slug, rift.image_path) == (custom, f"{self.tag}-custom", f"{BUCKET}custom.png")

    async def test_map11_row_matched_only_by_alias_is_a_conflict(self) -> None:
        renamed = await self._add_lol(f"{self.tag}-renamed", f"{self.tag} Renamed", aliases=[f"{self.tag} Rift"])
        await self._assert_refused_unchanged(renamed)

    async def test_map11_on_a_fresh_catalog_is_one_summoners_rift_row(self) -> None:
        _http, s3 = await self._sync_map11()
        (rift,) = await self._lol_maps()
        assert (rift.slug, rift.name, rift.attrs, rift.aliases, rift.active) == (
            "summoners_rift",
            f"{self.tag} Rift",
            {},
            [],
            True,
        )
        assert rift.image_path == f"{BUCKET}assets/lol/map/summoners_rift.png"
        assert s3.keys == ["assets/lol/map/summoners_rift.png"]

    async def test_map11_sync_leaves_manual_and_source_missing_maps_alone(self) -> None:
        await self._add_lol(f"{self.tag}-manual", f"{self.tag} Manual", attrs={"note": "hand-made"}, active=False)
        await self._add_lol(f"{self.tag}-gone", f"{self.tag} Gone", image_path=f"{BUCKET}assets/lol/map/gone.png")
        before = [_snapshot(m) for m in await self._lol_maps()]
        await self._sync_map11()
        after = await self._lol_maps()
        assert [_snapshot(m) for m in after if m.slug != "summoners_rift"] == before
        assert [m.name for m in after if m.slug == "summoners_rift"] == [f"{self.tag} Rift"]

    async def test_map11_failed_map_fetch_writes_nothing(self) -> None:
        class _MapSourceDown(_Http):
            async def get(self, path: str, **kwargs: object) -> _Response:
                if path.endswith("/map.json"):
                    raise RuntimeError("Data Dragon map.json is down")
                return await super().get(path, **kwargs)

        await self._add_lol(f"{self.tag}-rift", f"{self.tag} Rift", image_path="https://src/rift.png")
        before = [_snapshot(m) for m in await self._lol_maps()]
        s3 = _S3()
        with self.assertRaisesRegex(RuntimeError, "is down"):
            await self._sync_map11(_MapSourceDown(_map11_routes(self.tag)), s3)
        # The fetch precedes every write: no slug rewrite, no new row, nothing mirrored.
        assert [_snapshot(m) for m in await self._lol_maps()] == before
        assert s3.keys == []


def _map11_routes(tag: str) -> dict:
    """A Data Dragon source whose only map is id 11, named ``f"{tag} Rift"``; no champions."""
    return {
        "/api/versions.json": ["14.1.1"],
        "/cdn/14.1.1/data/en_US/champion.json": {"data": {}},
        "/cdn/14.1.1/data/en_US/map.json": {
            "data": {"11": {"MapName": f"{tag} Rift", "MapId": "11", "image": {"full": "map11.png"}}}
        },
    }


def _snapshot(entity: CatalogEntity) -> tuple:
    return (
        entity.id,
        entity.slug,
        entity.name,
        entity.image_path,
        entity.attrs,
        entity.aliases,
        entity.active,
        entity.parent_id,
    )
