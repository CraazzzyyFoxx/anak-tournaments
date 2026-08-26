from __future__ import annotations

import importlib
import os
import sys
from pathlib import Path
from types import SimpleNamespace
from unittest import IsolatedAsyncioTestCase
from unittest.mock import AsyncMock, patch
from uuid import uuid4

backend_root = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(backend_root))
sys.path.insert(0, str(backend_root / "tournament-service"))

os.environ["DEBUG"] = "true"

encounter_flows = importlib.import_module("src.services.encounter.flows")
encounter_schemas = importlib.import_module("src.schemas.encounter")


class EncounterCacheKeyTests(IsolatedAsyncioTestCase):
    async def test_encounter_list_cache_separates_search_queries(self) -> None:
        unique_prefix = str(uuid4())
        first = encounter_schemas.EncounterSearchParams(
            query=f"{unique_prefix}-first",
            fields=["name"],
        )
        second = encounter_schemas.EncounterSearchParams(
            query=f"{unique_prefix}-second",
            fields=["name"],
        )
        load_encounters = AsyncMock(return_value=([], 0))

        with patch.object(encounter_flows.flows_service.encounters, "get_all_encounters", load_encounters):
            await encounter_flows.flows_service.get_all_encounters(SimpleNamespace(), first)
            await encounter_flows.flows_service.get_all_encounters(SimpleNamespace(), second)

        self.assertEqual(load_encounters.await_count, 2)
