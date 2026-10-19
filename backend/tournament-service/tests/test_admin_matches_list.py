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
stats_reads = importlib.import_module("shared.repository.stats_reads")
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


def _participant(team_id: int, slot: int, source_position: int, source: int | None, *, name: str, **kw):
    return stats_reads.ParticipantContext(
        **{
            "seat": svc.models.EncounterTeam(
                id=team_id, encounter_id=10, slot=slot, team_id=source, name=name, active=slot != 1
            ),
            "source_position": source_position,
            "result": None,
            "team_facts": {},
            **kw,
        }
    )


def _read(*, job=None, **kw):
    return stats_reads.MatchReadContext(
        **{
            "match": svc.models.StatsMatch(
                id=100,
                workspace_id=7,
                discipline="overwatch",
                encounter_id=10,
                encounter_game_id=50,
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
            "map": svc.models.CatalogEntity(
                id=8,
                discipline="overwatch",
                kind="map",
                slug="ilios",
                name="Ilios",
                attrs={},
                aliases=[],
                active=True,
                created_at=datetime(2026, 1, 1, tzinfo=UTC),
            ),
            "job": job,
            # Three participants, the log's order reversed against the seats, one without a source team.
            "participants": (
                _participant(21, 1, 3, 1, name="Observed A", team_facts={"score": 2.0}),
                _participant(22, 2, 1, 2, name="Observed B", team_facts={"score": 1.0}),
                _participant(23, 3, 2, None, name="Observed C"),
            ),
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

    def test_nullable_filename_stays_null(self):
        row = _row(_read(job=_job(filename=None)))
        self.assertIsNone(row.log_record.filename)
        self.assertIsNone(row.log_name)

    def test_every_participant_is_listed_in_seat_order_with_its_own_source_and_facts(self):
        row = _row(_read())
        self.assertEqual(
            [(21, 1, 3, 1), (22, 2, 1, 2), (23, 3, 2, None)],
            [(p.encounter_team_id, p.slot, p.source_position, p.tournament_team_id) for p in row.participants],
        )
        # A missing fact is an absent key, never a zero; the official result is another fact.
        self.assertEqual([{"score": 2.0}, {"score": 1.0}, {}], [p.team_facts for p in row.participants])
        self.assertEqual([None, None, None], [p.result for p in row.participants])
        self.assertEqual("Ilios", row.map.name)
        self.assertFalse(
            {"home_team", "away_team", "home_score", "away_score", "time", "map_name"} & row.model_dump().keys()
        )


class PublicHistorySerialization(IsolatedAsyncioTestCase):
    async def test_unbound_observation_has_owner_but_no_official_position_or_raw(self):
        context = _read(game=None)
        context.match.source_map_index = 99
        row = await encounters.to_pydantic_match(None, context, [])

        self.assertEqual((100, 10, 8, 612.5), (row.id, row.encounter_id, row.map_id, row.duration_s))
        self.assertEqual((7, "overwatch"), (row.workspace_id, row.discipline))
        self.assertIsNone(row.map_index)
        self.assertIsNone(row.played_at)
        self.assertIsNone(row.raw_status)
        self.assertFalse(row.raw_available)
        self.assertIsNone(row.map)
        self.assertEqual(["Observed A", "Observed B", "Observed C"], [p.name for p in row.participants])

    async def test_the_map_expands_on_request_and_carries_its_mode_only_when_asked(self):
        row = await encounters.to_pydantic_match(None, _read(), ["map"])
        self.assertEqual("Ilios", row.map.name)
        self.assertIsNone(row.map.parent)

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
