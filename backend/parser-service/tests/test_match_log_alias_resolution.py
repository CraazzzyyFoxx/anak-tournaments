"""Log names resolve through catalog aliases, and misses reach the queue.

Canonical/translated names share the same catalog identity. Unresolved names
are retained until the owning processing transaction rolls back; the native
PostgreSQL suite covers their isolated breadcrumb commit and subsequent retry.
"""

from __future__ import annotations

import importlib
import os
import sys
from pathlib import Path
from types import SimpleNamespace
from unittest import IsolatedAsyncioTestCase
from unittest.mock import AsyncMock, Mock, patch

import pandas as pd

backend_root = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(backend_root))
sys.path.insert(0, str(backend_root / "parser-service"))

os.environ["DEBUG"] = "true"

flows = importlib.import_module("src.services.match_logs.flows")
map_service_module = importlib.import_module("src.services.map.service")
map_service = map_service_module.map_service
errors = flows.errors


def _processor() -> object:
    processor = flows.MatchLogProcessor.__new__(flows.MatchLogProcessor)
    processor.heroes_map = {}
    processor.hero_misses = set()
    processor.job = SimpleNamespace(id=11, workspace_id=1, discipline="overwatch")
    processor.map_misses = {}
    return processor


class HeroAliasResolutionTests(IsolatedAsyncioTestCase):
    async def test_preload_folds_db_aliases_into_the_hero_cache(self) -> None:
        ana = SimpleNamespace(name="Ana", aliases=["Ана", "アナ"])
        processor = _processor()

        with patch.object(flows._heroes, "get_all", AsyncMock(return_value=([ana], 1))):
            await processor._preload_data(Mock())

        self.assertIs(ana, processor.heroes_map["Ana"])
        self.assertIs(ana, processor.heroes_map["Ана"])
        self.assertIs(ana, processor.heroes_map["アナ"])

    async def test_a_canonical_name_is_never_shadowed_by_another_heros_alias(self) -> None:
        # Somebody attaches "Ana" as an alias of Ashe by mistake; Ana must win.
        ana = SimpleNamespace(name="Ana", aliases=[])
        ashe = SimpleNamespace(name="Ashe", aliases=["Ana", "Эш"])
        processor = _processor()

        with patch.object(flows._heroes, "get_all", AsyncMock(return_value=([ana, ashe], 2))):
            await processor._preload_data(Mock())

        self.assertIs(ana, processor.heroes_map["Ana"])
        self.assertIs(ashe, processor.heroes_map["Эш"])

    def test_the_canonical_name_never_needs_an_alias(self) -> None:
        processor = _processor()
        processor.heroes_map = {"Ana": SimpleNamespace(name="Ana")}

        self.assertEqual("Ana", processor.get_hero("Ana").name)
        self.assertEqual(set(), processor.hero_misses)

    def test_an_unknown_hero_is_queued_as_a_miss_and_still_raises(self) -> None:
        processor = _processor()

        with self.assertRaises(errors.ApiHTTPException):
            processor.get_hero("Хтоническая Сущность")

        # Unknown vocabulary rejects the entire revision instead of losing rows.
        self.assertEqual({"Хтоническая Сущность"}, processor.hero_misses)

    def test_repeated_misses_collapse_into_one_queued_name(self) -> None:
        processor = _processor()

        for _ in range(3):
            with self.assertRaises(errors.ApiHTTPException):
                processor.get_hero("Кулак Смерти")

        self.assertEqual({"Кулак Смерти"}, processor.hero_misses)


class MapAliasResolutionTests(IsolatedAsyncioTestCase):
    async def test_a_resolved_map_records_nothing(self) -> None:
        resolved = SimpleNamespace(id=3, name="Ilios")
        record_misses = AsyncMock()

        with (
            patch.object(map_service.repo, "get_map_by_name_or_alias", AsyncMock(return_value=resolved)),
            patch.object(map_service_module.catalog_aliases, "record_misses", record_misses),
        ):
            found = await map_service.get_by_name_or_alias_and_gamemode(Mock(), "Илиос", "Контроль")

        self.assertIs(resolved, found)
        record_misses.assert_not_awaited()

    async def test_an_unknown_map_defers_both_misses_until_processing_rollback(self) -> None:
        processor = _processor()
        processor._get_rows = Mock(return_value=pd.DataFrame({"data": [["Хогвартс", "Контроль"]]}))
        record_misses = AsyncMock()
        with (
            patch.object(map_service.repo, "get_map_by_name_or_alias", AsyncMock(return_value=None)),
            patch.object(map_service_module.catalog_aliases, "record_misses", record_misses),
            self.assertRaises(errors.ApiHTTPException),
        ):
            await processor.get_map(Mock())
        self.assertEqual({"map": {"Хогвартс"}, "mode": {"Контроль"}}, processor.map_misses)
        record_misses.assert_not_awaited()

    async def test_get_map_passes_the_raw_log_names_through_untranslated(self) -> None:
        processor = _processor()
        processor.df = pd.DataFrame()
        processor._get_rows = Mock(return_value=pd.DataFrame({"data": [["Илиос", "Контроль"]]}))
        resolve = AsyncMock(return_value=SimpleNamespace(id=3, name="Ilios"))

        with patch.object(flows.map_service, "get_by_name_or_alias_and_gamemode", resolve):
            await processor.get_map(Mock())

        resolve.assert_awaited_once()
        args, kwargs = resolve.await_args
        self.assertEqual(("Илиос", "Контроль"), args[1:])
        self.assertEqual({}, kwargs)
