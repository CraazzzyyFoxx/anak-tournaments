"""Native admin filter/DTO contracts; database counts and tenancy use the parity suite."""

from __future__ import annotations

import importlib
import os
import sys
from datetime import UTC, datetime
from pathlib import Path
from unittest import TestCase

backend_root = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(backend_root))
sys.path.insert(0, str(backend_root / "tournament-service"))
os.environ["DEBUG"] = "true"

svc = importlib.import_module("src.services.admin.matches")
schemas = importlib.import_module("src.schemas")
IngestJobStatus = importlib.import_module("shared.models.stats.ingest").IngestJobStatus
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
            "home_participant_id": 21,
            "away_participant_id": 22,
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
