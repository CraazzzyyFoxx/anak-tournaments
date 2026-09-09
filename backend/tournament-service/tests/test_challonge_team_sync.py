"""Tests for the Challonge participant/team mapping preview+apply pair.

Migrated from parser-service's ``teams.challonge_preview``/``teams.create_challonge``
(see docs/plans/2026-08-21-parser-service-oop-repositories.md's follow-up: parser's
bootstrap Challonge flows were a narrower one-shot reimplementation of what
tournament-service's own Challonge sync engine already does -- ``preview_team_mapping``/
``apply_team_mapping`` reuse ``discover_sources``/``_build_team_name_index`` via the
shared ``_fetch_team_sync_context`` helper, which these tests stub out to isolate the
orchestration logic (suggestion resolution, ambiguity, validation, create/update counting).
"""

from __future__ import annotations

import importlib
import os
import sys
from pathlib import Path
from types import SimpleNamespace
from unittest import IsolatedAsyncioTestCase
from unittest.mock import AsyncMock, patch

backend_root = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(backend_root))
sys.path.insert(0, str(backend_root / "tournament-service"))

os.environ["DEBUG"] = "true"

challonge_sync = importlib.import_module("src.services.challonge.sync")
schemas = importlib.import_module("src.schemas")


def _participant(
    id_: int, name: str, active: bool = True, group_player_ids: list[int] | None = None
) -> SimpleNamespace:
    return SimpleNamespace(id=id_, name=name, active=active, group_player_ids=group_player_ids or [])


def _team(id_: int, name: str, balancer_name: str | None = None) -> SimpleNamespace:
    return SimpleNamespace(id=id_, name=name, balancer_name=balancer_name)


def _source(source_id: int = 1, challonge_id: int = 900) -> object:
    return challonge_sync._ImportSource(challonge_id=challonge_id, source_id=source_id)


class _FakeSession:
    """``add_all``/``flush`` mirror what ``BaseRepository.create_many`` calls now
    that ``apply_team_mapping`` persists through the repository instead of a bare
    ``session.add``; ``added`` still counts exactly the rows written."""

    def __init__(self) -> None:
        self.added: list[object] = []

    async def commit(self) -> None:
        return None

    async def flush(self) -> None:
        return None

    def add(self, obj: object) -> None:
        self.added.append(obj)

    def add_all(self, objs: object) -> None:
        self.added.extend(objs)


class PreviewTeamMappingTests(IsolatedAsyncioTestCase):
    async def test_suggests_by_name_and_reports_existing_mapping(self) -> None:
        tournament = SimpleNamespace(id=1)
        source = _source()
        fetch = SimpleNamespace(matches=[], participants=[_participant(10, "Alpha"), _participant(11, "Bravo")])
        existing = SimpleNamespace(source_id=1, challonge_participant_id=11, team_id=99)

        with (
            patch.object(
                challonge_sync.mapping_service,
                "_fetch_team_sync_context",
                AsyncMock(return_value=(tournament, [_team(5, "Alpha")], [(source, fetch)])),
            ),
            patch.object(
                challonge_sync.mapping_service, "_build_team_name_index", AsyncMock(return_value={"alpha": 5})
            ),
            patch.object(
                challonge_sync.mapping_service,
                "_existing_participant_mappings",
                AsyncMock(return_value={(1, 11): existing}),
            ),
        ):
            result = await challonge_sync.sync_service.preview_team_mapping(_FakeSession(), 1)

        self.assertEqual([5], [t.id for t in result.teams])
        by_id = {p.participant_id: p for p in result.participants}
        self.assertEqual(5, by_id[10].suggested_team_id)
        self.assertIsNone(by_id[10].mapped_team_id)
        self.assertIsNone(by_id[11].suggested_team_id)
        self.assertEqual(99, by_id[11].mapped_team_id)

    async def test_ambiguous_name_suggests_nothing(self) -> None:
        tournament = SimpleNamespace(id=1)
        fetch = SimpleNamespace(matches=[], participants=[_participant(10, "Alpha")])

        with (
            patch.object(
                challonge_sync.mapping_service,
                "_fetch_team_sync_context",
                AsyncMock(return_value=(tournament, [], [(_source(), fetch)])),
            ),
            patch.object(
                challonge_sync.mapping_service,
                "_build_team_name_index",
                AsyncMock(return_value={"alpha": challonge_sync._AMBIGUOUS}),
            ),
            patch.object(challonge_sync.mapping_service, "_existing_participant_mappings", AsyncMock(return_value={})),
        ):
            result = await challonge_sync.sync_service.preview_team_mapping(_FakeSession(), 1)

        self.assertIsNone(result.participants[0].suggested_team_id)

    async def test_missing_tournament_raises_404(self) -> None:
        with patch.object(
            challonge_sync.mapping_service,
            "_fetch_team_sync_context",
            AsyncMock(side_effect=challonge_sync.HTTPException(status_code=404, detail="Tournament not found")),
        ):
            with self.assertRaises(challonge_sync.HTTPException) as ctx:
                await challonge_sync.sync_service.preview_team_mapping(_FakeSession(), 999)
        self.assertEqual(404, ctx.exception.status_code)


class ApplyTeamMappingTests(IsolatedAsyncioTestCase):
    async def test_creates_new_mapping(self) -> None:
        tournament = SimpleNamespace(id=1)
        fetch = SimpleNamespace(matches=[], participants=[_participant(10, "Alpha")])
        session = _FakeSession()

        with (
            patch.object(
                challonge_sync.mapping_service,
                "_fetch_team_sync_context",
                AsyncMock(return_value=(tournament, [_team(5, "Alpha")], [(_source(), fetch)])),
            ),
            patch.object(challonge_sync.mapping_service, "_existing_participant_mappings", AsyncMock(return_value={})),
        ):
            result = await challonge_sync.sync_service.apply_team_mapping(
                session, 1, [schemas.ChallongeTeamMapping(participant_id=10, group_id=None, team_id=5)]
            )

        self.assertTrue(result.success)
        self.assertEqual(1, result.created)
        self.assertEqual(0, result.updated)
        self.assertEqual(0, result.unchanged)
        self.assertEqual(1, len(session.added))

    async def test_maps_group_player_id_aliases(self) -> None:
        """Group-stage matches reference a participant's ``group_player_id``, not
        their top-level id -- the mapping applied here must cover both, or a match
        import still can't resolve a team the admin explicitly picked (see sync.py
        ``apply_team_mapping``)."""
        tournament = SimpleNamespace(id=1)
        fetch = SimpleNamespace(matches=[], participants=[_participant(10, "Alpha", group_player_ids=[101, 102])])
        session = _FakeSession()

        with (
            patch.object(
                challonge_sync.mapping_service,
                "_fetch_team_sync_context",
                AsyncMock(return_value=(tournament, [_team(5, "Alpha")], [(_source(), fetch)])),
            ),
            patch.object(challonge_sync.mapping_service, "_existing_participant_mappings", AsyncMock(return_value={})),
        ):
            result = await challonge_sync.sync_service.apply_team_mapping(
                session, 1, [schemas.ChallongeTeamMapping(participant_id=10, group_id=None, team_id=5)]
            )

        self.assertTrue(result.success)
        # One admin-facing "created" count, even though 3 rows (id + 2 aliases) are written.
        self.assertEqual(1, result.created)
        self.assertEqual(3, len(session.added))
        mapped_challonge_ids = {row.challonge_participant_id for row in session.added}
        self.assertEqual({10, 101, 102}, mapped_challonge_ids)
        self.assertTrue(all(row.team_id == 5 for row in session.added))

    async def test_updates_existing_mapping_when_team_changes(self) -> None:
        tournament = SimpleNamespace(id=1)
        fetch = SimpleNamespace(matches=[], participants=[_participant(10, "Alpha")])
        existing = SimpleNamespace(source_id=1, challonge_participant_id=10, team_id=7)

        with (
            patch.object(
                challonge_sync.mapping_service,
                "_fetch_team_sync_context",
                AsyncMock(return_value=(tournament, [_team(5, "Alpha")], [(_source(), fetch)])),
            ),
            patch.object(
                challonge_sync.mapping_service,
                "_existing_participant_mappings",
                AsyncMock(return_value={(1, 10): existing}),
            ),
        ):
            result = await challonge_sync.sync_service.apply_team_mapping(
                _FakeSession(),
                1,
                [schemas.ChallongeTeamMapping(participant_id=10, group_id=None, team_id=5)],
            )

        self.assertEqual(1, result.updated)
        self.assertEqual(0, result.created)
        self.assertEqual(5, existing.team_id)

    async def test_unchanged_mapping_is_not_recounted_as_updated(self) -> None:
        tournament = SimpleNamespace(id=1)
        fetch = SimpleNamespace(matches=[], participants=[_participant(10, "Alpha")])
        existing = SimpleNamespace(source_id=1, challonge_participant_id=10, team_id=5)

        with (
            patch.object(
                challonge_sync.mapping_service,
                "_fetch_team_sync_context",
                AsyncMock(return_value=(tournament, [_team(5, "Alpha")], [(_source(), fetch)])),
            ),
            patch.object(
                challonge_sync.mapping_service,
                "_existing_participant_mappings",
                AsyncMock(return_value={(1, 10): existing}),
            ),
        ):
            result = await challonge_sync.sync_service.apply_team_mapping(
                _FakeSession(),
                1,
                [schemas.ChallongeTeamMapping(participant_id=10, group_id=None, team_id=5)],
            )

        self.assertEqual(0, result.updated)
        self.assertEqual(0, result.created)
        self.assertEqual(1, result.unchanged)

    async def test_unknown_participant_rejects_whole_request(self) -> None:
        tournament = SimpleNamespace(id=1)
        with patch.object(
            challonge_sync.mapping_service,
            "_fetch_team_sync_context",
            AsyncMock(return_value=(tournament, [_team(5, "Alpha")], [])),
        ):
            with self.assertRaises(challonge_sync.HTTPException) as ctx:
                await challonge_sync.sync_service.apply_team_mapping(
                    _FakeSession(),
                    1,
                    [schemas.ChallongeTeamMapping(participant_id=999, group_id=None, team_id=5)],
                )
        self.assertEqual(400, ctx.exception.status_code)

    async def test_unknown_team_rejects_whole_request(self) -> None:
        tournament = SimpleNamespace(id=1)
        fetch = SimpleNamespace(matches=[], participants=[_participant(10, "Alpha")])
        with patch.object(
            challonge_sync.mapping_service,
            "_fetch_team_sync_context",
            AsyncMock(return_value=(tournament, [_team(5, "Alpha")], [(_source(), fetch)])),
        ):
            with self.assertRaises(challonge_sync.HTTPException) as ctx:
                await challonge_sync.sync_service.apply_team_mapping(
                    _FakeSession(),
                    1,
                    [schemas.ChallongeTeamMapping(participant_id=10, group_id=None, team_id=999)],
                )
        self.assertEqual(400, ctx.exception.status_code)
