from __future__ import annotations

import importlib
import os
import sys
from datetime import UTC, datetime
from pathlib import Path
from types import SimpleNamespace
from unittest import IsolatedAsyncioTestCase
from unittest.mock import AsyncMock, Mock, patch

backend_root = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(backend_root))
sys.path.insert(0, str(backend_root / "parser-service"))

os.environ["DEBUG"] = "false"
os.environ.setdefault("PROJECT_URL", "http://localhost")
os.environ.setdefault("REDIS_URL", "redis://localhost:6379/0")
os.environ.setdefault("POSTGRES_USER", "postgres")
os.environ.setdefault("POSTGRES_PASSWORD", "postgres")
os.environ.setdefault("POSTGRES_DB", "postgres")
os.environ.setdefault("POSTGRES_HOST", "localhost")
os.environ.setdefault("POSTGRES_PORT", "5432")
os.environ.setdefault("CHALLONGE_USERNAME", "test")
os.environ.setdefault("CHALLONGE_API_KEY", "test")

sync = importlib.import_module("src.services.challonge.sync")
encounter_flows = importlib.import_module("src.services.encounter.flows")
schemas = importlib.import_module("src.schemas")
enums = importlib.import_module("shared.core.enums")
stage_refs = importlib.import_module("shared.services.stage_refs")


class _Result:
    def __init__(self, *, one=None, all_values=None) -> None:
        self._one = one
        self._all_values = all_values or []

    def scalar_one_or_none(self):
        return self._one

    def scalars(self):
        return self

    def all(self):
        return self._all_values


def _challonge_match(
    *,
    match_id: int = 900,
    player1_id: int | None = 101,
    player2_id: int | None = 102,
    state: str = "complete",
    scores_csv: str = "2-1",
    round: int = 1,
    identifier: str = "A",
    group_id: int | None = None,
    player1_prereq_match_id: int | None = None,
    player2_prereq_match_id: int | None = None,
    player1_is_prereq_match_loser: bool = False,
    player2_is_prereq_match_loser: bool = False,
) -> schemas.ChallongeMatch:
    now = datetime.now(UTC)
    return schemas.ChallongeMatch(
        id=match_id,
        started_at=None,
        created_at=now,
        updated_at=now,
        player1_id=player1_id,
        player2_id=player2_id,
        player1_prereq_match_id=player1_prereq_match_id,
        player2_prereq_match_id=player2_prereq_match_id,
        player1_is_prereq_match_loser=player1_is_prereq_match_loser,
        player2_is_prereq_match_loser=player2_is_prereq_match_loser,
        round=round,
        identifier=identifier,
        state=state,
        scores_csv=scores_csv,
        tournament_id=700,
        group_id=group_id,
    )


def _challonge_participant(
    *,
    participant_id: int,
    name: str,
    group_player_ids: list[int],
) -> schemas.ChallongeParticipant:
    now = datetime.now(UTC)
    return schemas.ChallongeParticipant(
        id=participant_id,
        active=True,
        created_at=now,
        updated_at=now,
        name=name,
        tournament_id=700,
        group_player_ids=group_player_ids,
    )


class ChallongeSyncImportTests(IsolatedAsyncioTestCase):
    async def test_import_creates_missing_encounter_from_challonge_match(self) -> None:
        tournament = SimpleNamespace(
            id=7,
            challonge_id=700,
            challonge_slug="sample",
            stages=[],
            groups=[SimpleNamespace(id=10, is_groups=False, challonge_id=None, stage=None)],
        )
        home_team = SimpleNamespace(id=1, name="Alpha")
        away_team = SimpleNamespace(id=2, name="Beta")
        session = SimpleNamespace(
            execute=AsyncMock(
                side_effect=[
                    _Result(one=tournament),
                    _Result(all_values=[]),
                    _Result(
                        all_values=[
                            SimpleNamespace(
                                group_id=10,
                                challonge_id=101,
                                team_id=home_team.id,
                            ),
                            SimpleNamespace(
                                group_id=10,
                                challonge_id=102,
                                team_id=away_team.id,
                            ),
                        ]
                    ),
                    _Result(all_values=[home_team, away_team]),
                ]
            ),
            add=Mock(),
            flush=AsyncMock(),
            commit=AsyncMock(),
        )

        def add_side_effect(obj):
            if isinstance(obj, sync.models.Encounter):
                obj.id = 501

        session.add.side_effect = add_side_effect

        with (
            patch.object(sync.challonge_service, "fetch_matches", AsyncMock(return_value=[_challonge_match()])),
            patch.object(sync.challonge_service, "fetch_participants", AsyncMock(return_value=[])),
            patch.object(
                sync,
                "resolve_stage_refs_from_group",
                AsyncMock(
                    return_value=stage_refs.StageRefs(
                        stage_id=20,
                        stage_item_id=30,
                        tournament_group_id=10,
                    )
                ),
            ),
            patch.object(
                sync.standings_recalculation,
                "enqueue_tournament_recalculation",
                AsyncMock(),
            ) as enqueue_recalculation,
        ):
            result = await sync.import_tournament(session, tournament.id)

        created = next(
            obj for call in session.add.call_args_list
            for obj in call.args
            if isinstance(obj, sync.models.Encounter)
        )
        self.assertEqual(1, result["matches_synced"])
        self.assertEqual(1, result["matches_created"])
        self.assertEqual(0, result["errors"])
        self.assertEqual(900, created.challonge_id)
        self.assertEqual((home_team.id, away_team.id), (created.home_team_id, created.away_team_id))
        self.assertEqual((2, 1), (created.home_score, created.away_score))
        self.assertEqual(enums.EncounterStatus.COMPLETED, created.status)
        self.assertEqual((20, 30, 10), (created.stage_id, created.stage_item_id, created.tournament_group_id))
        session.commit.assert_awaited_once_with()
        enqueue_recalculation.assert_awaited_once_with(tournament.id)

    async def test_import_reports_missing_team_mapping_as_error(self) -> None:
        tournament = SimpleNamespace(
            id=7,
            challonge_id=700,
            challonge_slug="sample",
            stages=[],
            groups=[],
        )
        session = SimpleNamespace(
            execute=AsyncMock(
                side_effect=[
                    _Result(one=tournament),
                    _Result(all_values=[]),
                    _Result(all_values=[]),
                ]
            ),
            add=Mock(),
            flush=AsyncMock(),
            commit=AsyncMock(),
        )

        with (
            patch.object(sync.challonge_service, "fetch_matches", AsyncMock(return_value=[_challonge_match()])),
            patch.object(sync.challonge_service, "fetch_participants", AsyncMock(return_value=[])),
            patch.object(
                sync.standings_recalculation,
                "enqueue_tournament_recalculation",
                AsyncMock(),
            ) as enqueue_recalculation,
        ):
            result = await sync.import_tournament(session, tournament.id)

        self.assertEqual(0, result["matches_synced"])
        self.assertEqual(1, result["errors"])
        self.assertFalse(
            any(
                isinstance(obj, sync.models.Encounter)
                for call in session.add.call_args_list
                for obj in call.args
            )
        )
        session.commit.assert_awaited_once_with()
        enqueue_recalculation.assert_not_awaited()

    async def test_import_updates_existing_encounter_without_team_mapping(self) -> None:
        tournament = SimpleNamespace(
            id=7,
            challonge_id=700,
            challonge_slug="sample",
            stages=[],
            groups=[],
        )
        existing = SimpleNamespace(
            id=501,
            challonge_id=900,
            name="Existing",
            home_team_id=1,
            away_team_id=2,
            home_score=0,
            away_score=0,
            round=1,
            tournament_group_id=None,
            stage_id=None,
            stage_item_id=None,
            status=enums.EncounterStatus.OPEN,
        )
        session = SimpleNamespace(
            execute=AsyncMock(
                side_effect=[
                    _Result(one=tournament),
                    _Result(all_values=[existing]),
                    _Result(all_values=[]),
                ]
            ),
            add=Mock(),
            flush=AsyncMock(),
            commit=AsyncMock(),
        )

        with (
            patch.object(
                sync.challonge_service,
                "fetch_matches",
                AsyncMock(
                    return_value=[
                        _challonge_match(state="open", scores_csv="1-0")
                    ]
                ),
            ),
            patch.object(sync.challonge_service, "fetch_participants", AsyncMock(return_value=[])),
            patch.object(
                sync,
                "resolve_stage_refs_from_group",
                AsyncMock(
                    return_value=stage_refs.StageRefs(
                        stage_id=20,
                        stage_item_id=30,
                        tournament_group_id=None,
                    )
                ),
            ),
            patch.object(
                sync.standings_recalculation,
                "enqueue_tournament_recalculation",
                AsyncMock(),
            ) as enqueue_recalculation,
        ):
            result = await sync.import_tournament(session, tournament.id)

        self.assertEqual(1, result["matches_synced"])
        self.assertEqual(0, result["matches_created"])
        self.assertEqual(1, result["matches_updated"])
        self.assertEqual(0, result["errors"])
        self.assertEqual((1, 0), (existing.home_score, existing.away_score))
        self.assertEqual((20, 30), (existing.stage_id, existing.stage_item_id))
        self.assertEqual(enums.EncounterStatus.OPEN, existing.status)
        self.assertFalse(
            any(
                isinstance(obj, sync.models.Encounter)
                for call in session.add.call_args_list
                for obj in call.args
            )
        )
        enqueue_recalculation.assert_awaited_once_with(tournament.id)

    async def test_import_resolves_match_group_player_ids_from_participant_mapping(self) -> None:
        tournament = SimpleNamespace(
            id=7,
            challonge_id=700,
            challonge_slug="sample",
            stages=[],
            groups=[
                SimpleNamespace(
                    id=10,
                    is_groups=True,
                    challonge_id=123,
                    stage=None,
                )
            ],
        )
        home_team = SimpleNamespace(id=1, name="Alpha")
        away_team = SimpleNamespace(id=2, name="Beta")
        session = SimpleNamespace(
            execute=AsyncMock(
                side_effect=[
                    _Result(one=tournament),
                    _Result(all_values=[]),
                    _Result(
                        all_values=[
                            SimpleNamespace(
                                group_id=10,
                                challonge_id=101,
                                team_id=home_team.id,
                            ),
                            SimpleNamespace(
                                group_id=10,
                                challonge_id=102,
                                team_id=away_team.id,
                            ),
                        ]
                    ),
                    _Result(all_values=[home_team, away_team]),
                ]
            ),
            add=Mock(),
            flush=AsyncMock(),
            commit=AsyncMock(),
        )

        def add_side_effect(obj):
            if isinstance(obj, sync.models.Encounter):
                obj.id = 502

        session.add.side_effect = add_side_effect

        with (
            patch.object(
                sync.challonge_service,
                "fetch_participants",
                AsyncMock(
                    return_value=[
                        _challonge_participant(
                            participant_id=101,
                            name="Alpha",
                            group_player_ids=[44066538],
                        ),
                        _challonge_participant(
                            participant_id=102,
                            name="Beta",
                            group_player_ids=[44066539],
                        ),
                    ]
                ),
            ),
            patch.object(
                sync.challonge_service,
                "fetch_matches",
                AsyncMock(
                    return_value=[
                        _challonge_match(
                            player1_id=44066538,
                            player2_id=44066539,
                            group_id=123,
                        )
                    ]
                ),
            ),
            patch.object(
                sync,
                "resolve_stage_refs_from_group",
                AsyncMock(
                    return_value=stage_refs.StageRefs(
                        stage_id=20,
                        stage_item_id=30,
                        tournament_group_id=10,
                    )
                ),
            ),
            patch.object(
                sync.standings_recalculation,
                "enqueue_tournament_recalculation",
                AsyncMock(),
            ),
        ):
            result = await sync.import_tournament(session, tournament.id)

        self.assertEqual(1, result["matches_synced"])
        self.assertEqual(1, result["matches_created"])
        self.assertEqual(0, result["errors"])
        created = next(
            obj for call in session.add.call_args_list
            for obj in call.args
            if isinstance(obj, sync.models.Encounter)
        )
        self.assertEqual((home_team.id, away_team.id), (created.home_team_id, created.away_team_id))

    async def test_legacy_encounter_challonge_wrapper_uses_unified_import(self) -> None:
        session = SimpleNamespace()
        expected = {
            "matches_synced": 1,
            "matches_created": 1,
            "matches_updated": 0,
            "matches_skipped": 0,
            "errors": 0,
        }

        with patch.object(
            encounter_flows.challonge_sync,
            "import_tournament",
            AsyncMock(return_value=expected),
        ) as import_tournament:
            result = await encounter_flows.bulk_create_for_tournament_from_challonge(
                session,
                7,
            )

        self.assertEqual(expected, result)
        import_tournament.assert_awaited_once_with(session, 7)

    async def test_bulk_legacy_encounter_challonge_wrapper_aggregates_unified_import(self) -> None:
        session = SimpleNamespace()
        tournaments = [SimpleNamespace(id=1), SimpleNamespace(id=2)]

        with (
            patch.object(
                encounter_flows.tournament_service,
                "get_all",
                AsyncMock(return_value=tournaments),
            ),
            patch.object(
                encounter_flows.challonge_sync,
                "import_tournament",
                AsyncMock(
                    side_effect=[
                        {
                            "matches_synced": 2,
                            "matches_created": 1,
                            "matches_updated": 1,
                            "matches_skipped": 0,
                            "errors": 0,
                        },
                        {"error": "Tournament has no Challonge source"},
                    ]
                ),
            ),
        ):
            result = await encounter_flows.bulk_create_for_from_challonge(session)

        self.assertEqual(
            {
                "tournaments_synced": 2,
                "matches_synced": 2,
                "matches_created": 1,
                "matches_updated": 1,
                "matches_skipped": 0,
                "errors": 1,
            },
            result,
        )
