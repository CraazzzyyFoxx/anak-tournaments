"""The encounter list and overview caches embed ``MatchRead``; the native match cutover renamed their namespaces.

Their values are pickled in a Redis that outlives a deploy, and cashews hands an unpickled value back without
re-validating its nested models, so a warm pre-cutover entry would serve match documents without ``participants``.
The names changed instead (``native_encounters*``): nothing asks for an old entry any more. These tests pin the new
names against the keys cashews really renders, and that every tournament write still evicts them.
"""

from __future__ import annotations

import importlib
import inspect
import os
import sys
from pathlib import Path
from unittest import IsolatedAsyncioTestCase
from unittest.mock import AsyncMock, patch

from cashews import cache
from cashews.key import get_cache_key

backend_root = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(backend_root))
sys.path.insert(0, str(backend_root / "tournament-service"))
os.environ["DEBUG"] = "true"

flows = importlib.import_module("src.services.encounter.flows")
schemas = importlib.import_module("src.schemas")
invalidation = importlib.import_module("src.services.tournament.cache_invalidation")

from shared.services.realtime import Resource, Scope  # noqa: E402

_PRE_CUTOVER = ("encounters", "encounters_overview")


def _key(template: str, function, *, workspace_id: int | None, tournament_id: int | None) -> str:
    """The stored key: cashews renders ``prefix`` + ``:`` + template, so ``prefix="fastapi:"`` stores ``fastapi::...``.
    The invalidation globs lead with ``*``, which is what keeps them indifferent to that second colon."""
    kwargs = {
        "workspace_id": workspace_id,
        "params": schemas.EncounterSearchParams(tournament_id=tournament_id),
        "viewer_auth_user_id": None,
    }
    return "fastapi::" + get_cache_key(inspect.unwrap(function), template, kwargs=kwargs)


class EncounterCacheNamespaceTests(IsolatedAsyncioTestCase):
    async def asyncSetUp(self) -> None:
        cache.setup("mem://", prefix="fastapi:")
        cache.setup("mem://", prefix="backend:")
        await cache.delete_match("fastapi:*")

    def test_both_families_moved_off_their_pre_cutover_names(self) -> None:
        for template, function, name in (
            (flows.ENCOUNTERS_CACHE_KEY, flows.EncounterFlowsService.get_all_encounters, "native_encounters"),
            (
                flows.ENCOUNTERS_OVERVIEW_CACHE_KEY,
                flows.EncounterFlowsService.get_encounters_overview,
                "native_encounters_overview",
            ),
        ):
            key = _key(template, function, workspace_id=5, tournament_id=7)
            self.assertTrue(key.startswith(f"fastapi::{name}:5:7:"), key)
            for old in _PRE_CUTOVER:
                self.assertFalse(key.startswith(f"fastapi::{old}:"), f"{key!r} is still in the pre-cutover namespace")

    async def test_the_decorated_list_writes_the_native_key_and_a_tournament_write_drops_it(self) -> None:
        service = flows.flows_service
        read = AsyncMock(return_value=([], 0))
        with (
            patch.object(service.encounters, "get_all_encounters", read),
            patch.object(flows, "resolve_encounter_challonge", AsyncMock(return_value={})),
            patch.object(flows, "resolve_tournament_challonge", AsyncMock(return_value={})),
            patch.object(flows, "resolve_slot_sources", AsyncMock(return_value={})),
        ):
            for tournament_id in (7, 70):
                await service.get_all_encounters(
                    object(), schemas.EncounterSearchParams(tournament_id=tournament_id), workspace_id=5
                )
            stored = sorted([key async for key in cache.scan("fastapi:*")])
            self.assertEqual(2, len(stored))
            self.assertEqual(
                sorted(
                    _key(
                        flows.ENCOUNTERS_CACHE_KEY,
                        flows.EncounterFlowsService.get_all_encounters,
                        workspace_id=5,
                        tournament_id=t,
                    )
                    for t in (7, 70)
                ),
                stored,
            )

            await invalidation.invalidate_tournament_resources(
                Scope.tournament(7), frozenset({Resource.TOURNAMENT_ENCOUNTERS})
            )

            # Tournament 7 is evicted and 70 is not: the id is terminated in the pattern.
            self.assertEqual([key for key in stored if ":5:70:" in key], [key async for key in cache.scan("fastapi:*")])
            await service.get_all_encounters(object(), schemas.EncounterSearchParams(tournament_id=7), workspace_id=5)
        self.assertEqual(3, read.await_count, "the eviction did not force a rebuild")

    async def test_the_decorated_overview_writes_the_native_key_and_a_tournament_write_drops_it(self) -> None:
        service = flows.flows_service
        empty = {
            "total": 0,
            "with_logs_count": 0,
            "recent_count": 0,
            "avg_closeness": None,
            "live_now_count": 0,
            "upcoming_count": 0,
            "histogram_rows": [],
            "score_rows": [],
            "stage_rows": [],
            "hot_map_rows": [],
            "avg_series_seconds": None,
            "completed_series_count": 0,
            "sweep_count": 0,
            "went_distance_count": 0,
            "slot_one_wins": 0,
            "slot_two_wins": 0,
            "closest": [],
            "upcoming": [],
            "live": [],
            "preset_counts": {},
        }
        read = AsyncMock(return_value=empty)
        with (
            patch.object(service.encounters, "get_overview_data", read),
            patch.object(flows, "resolve_encounter_challonge", AsyncMock(return_value={})),
            patch.object(flows, "resolve_tournament_challonge", AsyncMock(return_value={})),
        ):
            params = schemas.EncounterSearchParams(tournament_id=7)
            await service.get_encounters_overview(object(), params, workspace_id=5)
            expected = _key(
                flows.ENCOUNTERS_OVERVIEW_CACHE_KEY,
                flows.EncounterFlowsService.get_encounters_overview,
                workspace_id=5,
                tournament_id=7,
            )
            self.assertEqual([expected], [key async for key in cache.scan("fastapi:*")])

            await invalidation.invalidate_tournament_resources(
                Scope.tournament(7), frozenset({Resource.TOURNAMENT_ENCOUNTERS})
            )

            self.assertEqual([], [key async for key in cache.scan("fastapi:*")])
            await service.get_encounters_overview(object(), params, workspace_id=5)
        self.assertEqual(2, read.await_count, "the eviction did not force a rebuild")

    async def test_every_resource_that_changes_an_encounter_drops_both_families(self) -> None:
        keys = {
            family: _key(template, function, workspace_id=5, tournament_id=7)
            for family, template, function in (
                ("list", flows.ENCOUNTERS_CACHE_KEY, flows.EncounterFlowsService.get_all_encounters),
                ("overview", flows.ENCOUNTERS_OVERVIEW_CACHE_KEY, flows.EncounterFlowsService.get_encounters_overview),
            )
        }
        other = _key(
            flows.ENCOUNTERS_OVERVIEW_CACHE_KEY,
            flows.EncounterFlowsService.get_encounters_overview,
            workspace_id=5,
            tournament_id=8,
        )
        for resource in (Resource.TOURNAMENT_ENCOUNTERS, Resource.TOURNAMENT_STRUCTURE):
            for key in (*keys.values(), other):
                await cache.set(key, 1)

            await invalidation.invalidate_tournament_resources(Scope.tournament(7), frozenset({resource}))

            for family, key in keys.items():
                self.assertIsNone(await cache.get(key), f"{resource}: the {family} entry survived the write")
            self.assertEqual(1, await cache.get(other), f"{resource}: another tournament's entry was evicted")
            await cache.delete_match("fastapi:*")
