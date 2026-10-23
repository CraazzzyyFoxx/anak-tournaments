"""Which writes miss which of this service's cached reads.

Each read is keyed by the generations of the resources ``cache_resources`` lists for it, and a write bumps exactly
the generations of what it staled: ``emit`` at the writer's own commit (whichever service that is), the
``cache.invalidated`` consumer again from the outbox. These pin what each resource misses, through real generations.
"""

from __future__ import annotations

import importlib
import sys
from pathlib import Path
from types import SimpleNamespace
from typing import Any
from unittest import IsolatedAsyncioTestCase
from unittest.mock import AsyncMock, patch

backend_root = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(backend_root))
sys.path.insert(0, str(backend_root / "tournament-service"))


cache_resources = importlib.import_module("src.services.tournament.cache_resources")
form_service_module = importlib.import_module("src.services.registration.form_service")

from shared.domain.forms import FormField, default_schema  # noqa: E402
from shared.schemas.events import CacheInvalidatedEvent  # noqa: E402
from shared.services.cache_generations import versioned  # noqa: E402
from shared.services.realtime import Resource, Scope  # noqa: E402
from shared.services.realtime.consumer import invalidate_from_event  # noqa: E402
from shared.testing.cache import configure_test_cache  # noqa: E402

_FAMILIES = {
    "detail": cache_resources.DETAIL,
    "encounters": cache_resources.ENCOUNTERS,
    "standings": cache_resources.STANDINGS,
    "teams": cache_resources.TEAMS,
    "registration_list": cache_resources.REGISTRATION_LIST,
}


class _Reads:
    """One cached read per family, keyed the way the real ones are: by the family's generations of one tournament."""

    def __init__(self) -> None:
        self.builds: list[tuple[str, int]] = []
        self.reads = {family: self._read(family, resources) for family, resources in _FAMILIES.items()}

    def _read(self, family: str, resources: tuple[Resource, ...]) -> Any:
        @versioned(
            generations=cache_resources.tournament_generations("{tournament_id}", resources),
            ttl="1m",
            key=f"probe:{family}:{{tournament_id}}",
            prefix="fastapi:",
        )
        async def read(tournament_id: int) -> str:
            self.builds.append((family, tournament_id))
            return family

        return read

    async def read_all(self, tournament_id: int) -> None:
        for read in self.reads.values():
            await read(tournament_id)


class ResourceMissTests(IsolatedAsyncioTestCase):
    async def asyncSetUp(self) -> None:
        configure_test_cache()

    async def _missed(self, *resources: Resource) -> set[str]:
        reads = _Reads()
        for tournament_id in (42, 7):
            await reads.read_all(tournament_id)
        reads.builds.clear()

        await invalidate_from_event(
            CacheInvalidatedEvent(scope_kind="tournament", scope_id=42, resources=[str(r) for r in resources])
        )
        for tournament_id in (42, 7):
            await reads.read_all(tournament_id)

        self.assertFalse([build for build in reads.builds if build[1] == 7], "another tournament's reads missed")
        return {family for family, _tournament_id in reads.builds}

    async def test_an_export_misses_the_teams_list_and_the_overview(self) -> None:
        # The e2e finding: right after a balancer export the public Teams tab stayed locked — the teams list and the
        # tournament read's teams_count were the pre-export copies.
        self.assertEqual(
            {"teams", "detail", "standings", "encounters"},
            await self._missed(Resource.TOURNAMENT_TEAMS, Resource.TOURNAMENT_STANDINGS, Resource.TOURNAMENT_STRUCTURE),
        )

    async def test_a_score_report_misses_encounters_and_standings(self) -> None:
        # Standings embed matches_history, built from completed encounters, so a score report moves them even though
        # no standings row was written.
        self.assertEqual({"encounters", "standings"}, await self._missed(Resource.TOURNAMENT_ENCOUNTERS))

    async def test_a_registration_misses_the_tournament_read_and_the_public_list_only(self) -> None:
        # The tournament read embeds live participants_count/registrations_count; nothing else moves.
        self.assertEqual({"detail", "registration_list"}, await self._missed(Resource.TOURNAMENT_REGISTRATIONS))

    async def test_a_form_edit_misses_the_public_list_only(self) -> None:
        # A row with a NULL `form_version_id` is rendered against the CURRENT schema's public keys.
        self.assertEqual({"registration_list"}, await self._missed(Resource.TOURNAMENT_REGISTRATION_FORM))

    async def test_streams_miss_nothing_here(self) -> None:
        # Stream reads live in stream-service.
        self.assertEqual(set(), await self._missed(Resource.TOURNAMENT_STREAMS))


class _FakeSession:
    """Only what ``save_schema`` touches: the version-number read, flush, commit."""

    async def execute(self, _statement: Any) -> Any:
        return SimpleNamespace(scalar_one_or_none=lambda: 1)

    async def flush(self) -> None:
        return None

    async def commit(self) -> None:
        return None


class SchemaSaveInvalidationTests(IsolatedAsyncioTestCase):
    """The join the tests above stop short of: what a schema save actually emits, against the real read keys."""

    async def asyncSetUp(self) -> None:
        configure_test_cache()

    async def test_a_schema_save_misses_the_public_registration_list(self) -> None:
        # Redacting a field to `organizers` must take effect for the rows whose `form_version_id` is NULL — they are
        # rendered against the CURRENT schema, so the cached anonymous list is stale the moment it is saved.
        reads = _Reads()
        await reads.reads["registration_list"](42)
        redacted = default_schema("battlenet")
        redacted.sections[2].fields.append(FormField(key="vk", kind="url", label="VK", visibility="organizers"))
        form = SimpleNamespace(
            id=1,
            tournament_id=42,
            current_version=SimpleNamespace(schema_json=default_schema("battlenet").model_dump(mode="json")),
            current_version_id=None,
        )
        emitted: list[tuple[Scope, frozenset[Resource]]] = []

        async def _emit(_session: Any, *, scope: Scope, invalidates: Any, **_kwargs: Any) -> None:
            emitted.append((scope, frozenset(invalidates)))

        with (
            patch.object(form_service_module, "emit", _emit),
            patch.object(form_service_module.form_service, "get_form", AsyncMock(return_value=form)),
        ):
            await form_service_module.form_service.save_schema(_FakeSession(), form, redacted, actor_user_id=None)

        self.assertEqual(len(emitted), 1)
        scope, resources = emitted[0]
        await invalidate_from_event(
            CacheInvalidatedEvent(scope_kind=str(scope.kind), scope_id=scope.id, resources=sorted(resources))
        )
        await reads.reads["registration_list"](42)

        self.assertEqual([("registration_list", 42), ("registration_list", 42)], reads.builds)
