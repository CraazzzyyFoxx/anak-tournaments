"""Native admin filter/DTO contracts; database counts and tenancy use the parity suite."""

from __future__ import annotations

import importlib
import os
import sys
from datetime import UTC, datetime
from pathlib import Path
from unittest import IsolatedAsyncioTestCase, TestCase

backend_root = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(backend_root))
sys.path.insert(0, str(backend_root / "tournament-service"))
os.environ["DEBUG"] = "true"

svc = importlib.import_module("src.services.admin.matches")
schemas = importlib.import_module("src.schemas")
IngestJobStatus = importlib.import_module("shared.models.stats.ingest").IngestJobStatus
RawSourceStatus = importlib.import_module("shared.models.stats.ingest").RawSourceStatus
encounters = importlib.import_module("src.services.encounter.flows").flows_service
build_query_model = importlib.import_module("shared.rpc.query").build_query_model


def _job(**kw):
    return svc.models.IngestJob(
        **{
            "id": 77,
            "filename": "logs/match.txt",
            "status": IngestJobStatus.DONE,
            "source_kind": "upload",
            "uploader_user_id": 5,
            "attempts": 1,
            "error_message": None,
            "created_at": datetime(2026, 4, 1, tzinfo=UTC),
            "started_at": None,
            "finished_at": None,
            **kw,
        }
    )


def _read(*, job=None, **kw):
    return svc.MatchReadContext(
        **{
            "match": svc.models.StatsMatch(
                id=100,
                workspace_id=7,
                discipline="overwatch",
                encounter_id=10,
                map_entity_id=8,
                duration_s=612.5,
                created_at=datetime(2026, 5, 1, tzinfo=UTC),
            ),
            "game": svc.models.EncounterGame(id=50, encounter_id=10, position=2, map_id=8),
            "encounter": svc.models.Encounter(
                id=10,
                name="A vs B",
                tournament_id=3,
                tournament=svc.models.Tournament(id=3, name="Cup"),
            ),
            "map": svc.models.CatalogEntity(id=8, name="Ilios"),
            "job": job,
            "home_participation": svc.models.EncounterTeam(
                id=21, encounter_id=10, slot=1, team_id=1, name="Observed A", active=False, score=4
            ),
            "away_participation": svc.models.EncounterTeam(
                id=22, encounter_id=10, slot=2, team_id=2, name="Observed B", active=True, score=3
            ),
            "home_team": svc.models.Team(id=1, name="A"),
            "away_team": svc.models.Team(id=2, name="B"),
            "home_score": 2,
            "away_score": 1,
            "display_filename": job.filename if job is not None else None,
            **kw,
        }
    )


def _row(read):
    return schemas.AdminMatchRow(**svc._row_fields(read))


class RowDerivation(TestCase):
    def test_a_no_raw_observation_has_no_fabricated_filename_or_record(self):
        row = _row(_read())
        self.assertIsNone(row.log_record)
        self.assertIsNone(row.log_name)
        self.assertNotIn("code", row.model_dump())

    def test_a_job_carries_exact_filename_and_ingestion_state(self):
        row = _row(_read(job=_job(status=IngestJobStatus.FAILED, error_message="log_not_found")))
        self.assertEqual((77, "logs/match.txt"), (row.log_record.id, row.log_name))
        self.assertEqual(IngestJobStatus.FAILED, row.log_record.status)
        self.assertEqual("log_not_found", row.log_record.error_message)

    def test_nullable_filename_and_source_teams_stay_null(self):
        row = _row(_read(job=_job(filename=None), home_team=None, away_team=None))
        self.assertIsNone(row.log_record.filename)
        self.assertIsNone(row.log_name)
        self.assertIsNone(row.home_team)
        self.assertIsNone(row.away_team)


class PublicHistorySerialization(IsolatedAsyncioTestCase):
    async def test_unbound_observation_has_owner_but_no_official_position_or_raw(self):
        context = _read(game=None)
        context.match.source_map_index = 99
        row = await encounters.to_pydantic_match(None, context, [])

        self.assertEqual((100, 10, 8, 612.5), (row.id, row.encounter_id, row.map_id, row.time))
        self.assertEqual((7, "overwatch"), (row.workspace_id, row.discipline))
        self.assertEqual((2, 1), (row.score.home, row.score.away))
        self.assertIsNone(row.map_index)
        self.assertIsNone(row.raw_status)
        self.assertFalse(row.raw_available)
        self.assertEqual((21, 22), (row.home_participation.id, row.away_participation.id))
        self.assertEqual("Observed A", row.home_participation.name)
        self.assertFalse(row.home_participation.active)
        self.assertEqual(4, row.home_participation.score)

    async def test_raw_capability_comes_from_source_state_not_filename_or_binding(self):
        for raw_status, content_hash, filename, available in (
            (RawSourceStatus.AVAILABLE, "a" * 64, None, True),
            (RawSourceStatus.MISSING, None, "logs/match.txt", False),
            (RawSourceStatus.CONFLICT, "b" * 64, "logs/match.txt", False),
            (RawSourceStatus.UNVERIFIED, None, "logs/match.txt", False),
        ):
            with self.subTest(raw_status=raw_status):
                job = _job(raw_status=raw_status, content_hash=content_hash, filename=filename)
                row = await encounters.to_pydantic_match(None, _read(job=job, game=None), [])

                self.assertEqual(raw_status.value, row.model_dump(mode="json")["raw_status"])
                self.assertEqual(available, row.raw_available)
                self.assertEqual(filename, row.log_name)
                self.assertIsNone(row.map_index)


class QueryStringRoundTrip(TestCase):
    def _parse(self, query):
        return schemas.AdminMatchesSearchParams.from_query_params(
            build_query_model(schemas.AdminMatchesQueryParams, query)
        )

    def test_every_filter_survives_gateway_encoding(self):
        params = self._parse(
            {
                "tournament_id": ["7"],
                "encounter_id": ["9"],
                "map_id": ["4"],
                "log_status": ["failed", "pending"],
                "unlinked_only": ["true"],
                "query": ["ilios"],
                "per_page": ["50"],
            }
        )
        self.assertEqual((7, 9, 4), (params.tournament_id, params.encounter_id, params.map_id))
        self.assertEqual([IngestJobStatus.FAILED, IngestJobStatus.PENDING], params.log_status)
        self.assertTrue(params.unlinked_only)
        self.assertEqual(("ilios", 50), (params.query, params.per_page))
