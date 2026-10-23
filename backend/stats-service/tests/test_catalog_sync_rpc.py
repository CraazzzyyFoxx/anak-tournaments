"""Catalog sync is one superuser background job per discipline, dispatched through the discipline registry."""

from __future__ import annotations

import asyncio
import importlib
import json
import logging
import sys
from pathlib import Path
from types import SimpleNamespace
from unittest import IsolatedAsyncioTestCase
from unittest.mock import patch

import fakeredis.aioredis
import httpx

backend_root = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(backend_root))
sys.path.insert(0, str(backend_root / "stats-service"))


rpc_misc = importlib.import_module("src.rpc.misc")
service = importlib.import_module("src.services.catalog_sync")

from shared.core.errors import ApiExc, ApiHTTPException
from shared.disciplines import DisciplineSpec
from shared.services.realtime_topics import realtime_channel
from tests._fakes import FakeBroker, active_identity, session_factory

KINDS = {"mode": "Mode", "map": "Map", "character": "Hero"}


def _stage(key: str, state: str, done: int | None = None, total: int | None = None, created: int | None = None):
    return {"key": key, "state": state, "done": done, "total": total, "created": created}


class CatalogSyncRpcTests(IsolatedAsyncioTestCase):
    def setUp(self) -> None:
        self.broker = FakeBroker()
        rpc_misc.register(self.broker, logging.getLogger("test"))
        self.session = SimpleNamespace()
        self.redis = fakeredis.aioredis.FakeRedis(decode_responses=True)
        for patcher in (
            patch.object(rpc_misc, "_SF", session_factory(self.session)),
            patch.object(service, "realtime_redis", self.redis),
        ):
            patcher.start()
            self.addCleanup(patcher.stop)

    async def _call(self, subject: str, discipline: str = "test", identity: dict | None = None) -> dict:
        handler = self.broker.handlers[subject]
        return await handler({"identity": identity or active_identity(), "discipline": discipline}, msg=None)

    async def _finish(self) -> None:
        await asyncio.gather(*list(service._tasks))

    def _discipline(self, sync):
        return patch.dict(service.DISCIPLINES, {"test": DisciplineSpec("test", "Test", kinds=KINDS, catalog_sync=sync)})

    async def test_a_sync_runs_in_the_background_and_publishes_every_snapshot_to_its_starter(self) -> None:
        release = asyncio.Event()

        async def sync(session, images, progress) -> None:
            session.synced = images
            await progress.report_source("Test source")
            await release.wait()
            for kind in KINDS:
                await progress.begin(kind)
                await progress.images(kind, 2 if kind == "map" else 0)
                if kind == "map":
                    await progress.image_mirrored(kind)
                    await progress.image_mirrored(kind)
                await progress.finish(kind, 1)

        pubsub = self.redis.pubsub()
        await pubsub.subscribe(realtime_channel("user:7:catalog-sync"))
        with self._discipline(sync):
            started = await self._call("rpc.stats.catalog.sync")
            # POST answered before the sync wrote anything.
            self.assertTrue(started["ok"], started)
            self.assertEqual(started["data"]["status"], "running")
            self.assertEqual(started["data"]["started_by"], 7)
            self.assertEqual(
                started["data"]["stages"],
                [_stage("source", "running"), *(_stage(kind, "pending") for kind in KINDS)],
            )
            release.set()
            await self._finish()
            status = await self._call("rpc.stats.catalog.sync_status")
        self.assertIs(self.session.synced, service.images)
        self.assertTrue(status["ok"], status)
        state = status["data"]
        self.assertEqual((state["status"], state["source"], state["error"]), ("done", "Test source", None))
        self.assertEqual(
            state["stages"],
            [
                _stage("source", "done"),
                _stage("mode", "done", done=0, total=0, created=1),
                _stage("map", "done", done=2, total=2, created=1),
                _stage("character", "done", done=0, total=0, created=1),
            ],
        )
        self.assertIsNone(await self.redis.get("catalog_sync:test:lock"))
        self.assertGreater(await self.redis.ttl("catalog_sync:test"), service.RUNNING_TTL)
        frames = []
        while (message := await pubsub.get_message(timeout=0)) is not None:
            if message["type"] == "message":
                frames.append(json.loads(message["data"]))
        self.assertEqual({frame["event"]["event_type"] for frame in frames}, {"catalog_sync.progress"})
        self.assertEqual({frame["event"]["event_id"] for frame in frames}, {0})
        self.assertEqual(frames[-1]["event"]["data"], state)
        # One frame per change: start, source, then begin/images/finish per kind plus the two map images.
        self.assertEqual(len(frames), 2 + 3 * 3 + 2 + 1)

    async def test_a_second_start_while_one_runs_is_a_conflict(self) -> None:
        release = asyncio.Event()

        async def sync(session, images, progress) -> None:
            await release.wait()

        with self._discipline(sync):
            first = await self._call("rpc.stats.catalog.sync")
            second = await self._call("rpc.stats.catalog.sync")
            release.set()
            await self._finish()
            third = await self._call("rpc.stats.catalog.sync")
            await self._finish()
        self.assertTrue(first["ok"], first)
        self.assertFalse(second["ok"], second)
        self.assertEqual(second["error"]["code"], "conflict")
        self.assertEqual(second["error"]["details"]["fields"][0]["code"], "catalog_sync_running")
        self.assertTrue(third["ok"], third)  # a finished sync released its lock

    async def test_a_failing_sync_is_a_failed_snapshot_keeping_its_finished_stages_and_releasing_the_lock(self) -> None:
        unavailable = "The Test catalog source did not answer (ConnectError); try again in a minute"
        cases = (
            (httpx.ConnectError("down"), "catalog_source_unavailable", unavailable),
            (ApiHTTPException(409, [ApiExc(code="catalog_conflict", msg="fix it")]), "catalog_conflict", "fix it"),
            (RuntimeError("boom"), "internal_error", "RuntimeError: boom"),
        )
        for exc, code, msg in cases:
            with self.subTest(code=code):

                async def sync(session, images, progress, exc=exc) -> None:
                    await progress.report_source("Test source")
                    await progress.begin("mode")
                    await progress.finish("mode", 2)
                    await progress.begin("map")
                    raise exc

                with self._discipline(sync):
                    self.assertTrue((await self._call("rpc.stats.catalog.sync"))["ok"])
                    await self._finish()
                    state = (await self._call("rpc.stats.catalog.sync_status"))["data"]
                self.assertEqual((state["status"], state["error"]), ("failed", {"code": code, "msg": msg}))
                self.assertEqual(
                    state["stages"],
                    [
                        _stage("source", "done"),
                        _stage("mode", "done", created=2),
                        _stage("map", "failed"),
                        _stage("character", "pending"),
                    ],
                )
                self.assertIsNone(await self.redis.get("catalog_sync:test:lock"))

    async def test_the_status_is_null_when_nothing_is_stored(self) -> None:
        with self._discipline(lambda *_: asyncio.sleep(0)):
            envelope = await self._call("rpc.stats.catalog.sync_status")
        self.assertTrue(envelope["ok"], envelope)
        self.assertIsNone(envelope["data"])

    async def test_a_discipline_without_a_sync_returns_not_found(self) -> None:
        with patch.dict(service.DISCIPLINES, {"test": DisciplineSpec("test", "Test")}, clear=True):
            for subject in ("rpc.stats.catalog.sync", "rpc.stats.catalog.sync_status"):
                for code in ("test", "unknown", ""):
                    with self.subTest(subject=subject, discipline=code):
                        envelope = await self._call(subject, code)
                        self.assertFalse(envelope["ok"], envelope)
                        self.assertEqual(envelope["error"]["code"], "not_found")

    async def test_a_non_superuser_cannot_sync_or_read_global_catalog_content(self) -> None:
        actor = {**active_identity(), "is_superuser": False}
        for subject in ("rpc.stats.catalog.sync", "rpc.stats.catalog.sync_status"):
            with self.subTest(subject=subject):
                envelope = await self._call(subject, "overwatch", actor)
                self.assertFalse(envelope["ok"], envelope)
                self.assertEqual(envelope["error"]["code"], "forbidden")
