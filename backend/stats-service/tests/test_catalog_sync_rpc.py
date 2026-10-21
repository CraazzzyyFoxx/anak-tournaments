"""Catalog sync is one superuser action dispatched through the discipline registry."""

from __future__ import annotations

import importlib
import logging
import sys
from pathlib import Path
from types import SimpleNamespace
from unittest import IsolatedAsyncioTestCase
from unittest.mock import patch

backend_root = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(backend_root))
sys.path.insert(0, str(backend_root / "stats-service"))


rpc_misc = importlib.import_module("src.rpc.misc")

from shared.disciplines import DisciplineSpec
from tests._fakes import FakeBroker, active_identity, session_factory


class CatalogSyncRpcTests(IsolatedAsyncioTestCase):
    def setUp(self) -> None:
        self.broker = FakeBroker()
        rpc_misc.register(self.broker, logging.getLogger("test"))
        self.session = SimpleNamespace()
        self.sf_patch = patch.object(rpc_misc, "_SF", session_factory(self.session))
        self.sf_patch.start()
        self.addCleanup(self.sf_patch.stop)

    async def test_superuser_syncs_the_requested_registry_module(self) -> None:
        handler = self.broker.handlers["rpc.stats.catalog.sync"]

        async def sync(session, images) -> None:
            session.synced = images

        spec = DisciplineSpec("test", "Test", catalog_sync=sync)
        with patch.dict(rpc_misc.DISCIPLINES, {"test": spec}):
            envelope = await handler({"identity": active_identity(), "discipline": "test"}, msg=None)
        self.assertTrue(envelope["ok"], envelope)
        self.assertEqual(envelope["data"], {"success": True})
        self.assertIs(self.session.synced, rpc_misc._catalog_images)

    async def test_a_discipline_without_a_sync_returns_not_found(self) -> None:
        handler = self.broker.handlers["rpc.stats.catalog.sync"]
        with patch.dict(rpc_misc.DISCIPLINES, {"test": DisciplineSpec("test", "Test")}, clear=True):
            for code in ("test", "unknown", ""):
                with self.subTest(discipline=code):
                    envelope = await handler({"identity": active_identity(), "discipline": code}, msg=None)
                    self.assertFalse(envelope["ok"], envelope)
                    self.assertEqual(envelope["error"]["code"], "not_found")

    async def test_a_non_superuser_cannot_sync_global_catalog_content(self) -> None:
        handler = self.broker.handlers["rpc.stats.catalog.sync"]
        actor = {**active_identity(), "is_superuser": False}
        envelope = await handler({"identity": actor, "discipline": "overwatch"}, msg=None)
        self.assertFalse(envelope["ok"], envelope)
        self.assertEqual(envelope["error"]["code"], "forbidden")
