"""Derivations behind the parsed-matches list and detail.

What SQL alone cannot pin here is the shape of the predicate set: which clauses
are tenancy and which are the caller narrowing, and — critically — that an
*absent* filter contributes nothing. The log record is a LEFT join because most
rows resolve none; a filter that quietly defaulted to "every status" would turn it
into an inner join and hide the majority of the table.

The detail's 404 is the other thing worth a test: "no such match" and "not your
match" must be indistinguishable, or the endpoint enumerates other tenants' ids.
"""

from __future__ import annotations

import importlib
import os
import sys
from datetime import UTC, datetime
from pathlib import Path
from types import SimpleNamespace
from unittest import IsolatedAsyncioTestCase, TestCase

backend_root = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(backend_root))
sys.path.insert(0, str(backend_root / "tournament-service"))

os.environ["DEBUG"] = "true"
os.environ.setdefault("PROJECT_URL", "http://localhost")
os.environ.setdefault("RABBITMQ_URL", "amqp://guest:guest@localhost:5672")
os.environ.setdefault("REDIS_URL", "redis://localhost:6379/0")
os.environ.setdefault("POSTGRES_USER", "postgres")
os.environ.setdefault("POSTGRES_PASSWORD", "postgres")
os.environ.setdefault("POSTGRES_DB", "postgres")
os.environ.setdefault("POSTGRES_HOST", "localhost")
os.environ.setdefault("POSTGRES_PORT", "5432")
os.environ.setdefault("CHALLONGE_USERNAME", "test")
os.environ.setdefault("CHALLONGE_API_KEY", "test")

svc = importlib.import_module("src.services.admin.matches")
schemas = importlib.import_module("src.schemas")
log_processing = importlib.import_module("shared.models.ingestion.log_processing")
errors = importlib.import_module("shared.core.errors")

build_query_model = importlib.import_module("shared.rpc.query").build_query_model

LogProcessingStatus = log_processing.LogProcessingStatus
LogProcessingSource = log_processing.LogProcessingSource


def _record(**kw):
    base = {
        "id": 77,
        "filename": "match.txt",
        "status": LogProcessingStatus.done,
        "source": LogProcessingSource.upload,
        "uploader_id": 5,
        "attempts": 1,
        "error_message": None,
        "created_at": datetime(2026, 4, 1, tzinfo=UTC),
        "started_at": None,
        "finished_at": None,
    }
    return SimpleNamespace(**{**base, **kw})


def _match(*, log_record=None, **kw):
    base = {
        "id": 100,
        "encounter_id": 10,
        "encounter": SimpleNamespace(name="A vs B", tournament_id=3, tournament=SimpleNamespace(id=3, name="Cup")),
        "map_id": 8,
        "map": SimpleNamespace(name="Ilios"),
        "home_team": SimpleNamespace(id=1, name="A"),
        "away_team": SimpleNamespace(id=2, name="B"),
        "home_score": 2,
        "away_score": 1,
        "time": 612.5,
        "log_name": "match.txt",
        "code": "ABC123",
        "created_at": datetime(2026, 5, 1, tzinfo=UTC),
        "log_record": log_record,
    }
    return SimpleNamespace(**{**base, **kw})


def _params(**kw):
    params = schemas.AdminMatchesSearchParams(page=1, per_page=25)
    for key, value in kw.items():
        setattr(params, key, value)
    return params


class _Result:
    """Enough of a SQLAlchemy Result for the two shapes the service uses."""

    def __init__(self, value):
        self._value = value

    def unique(self):
        return self

    def scalar_one_or_none(self):
        return self._value

    def one(self):
        return self._value


class _ScriptedSession:
    """Answers `execute`/`scalar` from a script and remembers the SQL it saw."""

    def __init__(self, *results):
        self._results = list(results)
        self.sql: list[str] = []

    async def execute(self, query):
        self.sql.append(str(query))
        return _Result(self._results.pop(0))

    async def scalar(self, query):
        self.sql.append(str(query))
        return self._results.pop(0)


class PredicatePartitioning(TestCase):
    """Scope decides which rows exist for this caller; provenance only narrows
    inside it. Collapsing the two would let a provenance filter widen the tenancy
    boundary, or a missing one silently narrow it."""

    def test_workspace_is_always_scoped(self):
        """Without it the list spans every tenant in the installation."""
        builder = svc._Query(1, _params())
        self.assertEqual(2, len(builder.scope_predicates()), "workspace + source=log_parser")
        self.assertIn("workspace_id", str(builder.scope_predicates()[0]))

    def test_source_is_always_scoped_to_log_parser(self):
        """A source=captain_report Match has no log/stats; this view's unit is
        one played map the log parser produced (module docstring) — it must
        never leak the other source in, scope or no scope."""
        builder = svc._Query(1, _params())
        self.assertIn("match.source", str(builder.scope_predicates()[1]).lower())

    def test_provenance_filters_are_not_scope(self):
        builder = svc._Query(
            1,
            _params(
                tournament_id=7,
                encounter_id=9,
                map_id=4,
                log_status=[LogProcessingStatus.failed],
                unlinked_only=True,
            ),
        )
        self.assertEqual(5, len(builder.scope_predicates()), "workspace + source + tournament + encounter + map")
        self.assertEqual(2, len(builder.provenance_predicates()))

    def test_no_filters_means_no_provenance_predicates(self):
        self.assertEqual([], svc._Query(1, _params()).provenance_predicates())

    def test_an_empty_log_status_adds_nothing(self):
        """The record is LEFT-joined and most matches resolve none. Expanding an
        empty selection into "all four statuses" would exclude every row whose
        provenance is unresolved — the overwhelming majority."""
        builder = svc._Query(1, _params(log_status=[]))
        self.assertEqual([], builder.provenance_predicates())

    def test_a_nonempty_log_status_filters_the_joined_record(self):
        builder = svc._Query(1, _params(log_status=[LogProcessingStatus.failed]))
        predicate = str(builder.provenance_predicates()[0])
        self.assertIn("log_record.status", predicate)

    def test_unlinked_only_asks_for_a_null_fk(self):
        """It selects the un-backfilled majority, so it has to be IS NULL on the
        match's own column — not a predicate on the joined record, which is
        already NULL for exactly those rows."""
        builder = svc._Query(1, _params(unlinked_only=True))
        predicate = str(builder.provenance_predicates()[0])
        self.assertIn("log_record_id IS NULL", predicate)

    def test_search_covers_the_log_name_the_code_and_both_teams(self):
        builder = svc._Query(1, _params(query="ilios"))
        predicate = str(builder.scope_predicates()[-1]).lower()
        for expected in ("match.log_name", "match.code", "home_team.name", "away_team.name"):
            self.assertIn(expected, predicate)


class RowDerivation(TestCase):
    def test_an_unresolved_record_is_none_not_a_placeholder(self):
        """The design book forbids presenting an unknown as a value: the sheet
        renders "provenance unresolved" from this being None (D28)."""
        row = svc._row(_match())
        self.assertIsNone(row.log_record)
        self.assertEqual("match.txt", row.log_name, "the log stays downloadable via log_name")

    def test_a_resolved_record_carries_the_ingestion_state(self):
        row = svc._row(_match(log_record=_record(status=LogProcessingStatus.failed, error_message="log_not_found")))
        self.assertEqual(77, row.log_record.id)
        self.assertEqual(LogProcessingStatus.failed, row.log_record.status)
        self.assertEqual("log_not_found", row.log_record.error_message)

    def test_the_row_names_its_encounter_tournament_and_map(self):
        row = svc._row(_match())
        self.assertEqual(
            ("A vs B", 3, "Cup", "Ilios"),
            (row.encounter_name, row.tournament_id, row.tournament_name, row.map_name),
        )
        self.assertEqual((1, 2), (row.home_team.id, row.away_team.id))

    def test_the_list_row_carries_no_stat_counts(self):
        """NFR 3: three aggregates per row would be three scans of the hot tables
        per page. They exist on the detail only."""
        for name in ("statistics_count", "kill_feed_count", "event_count", "rounds"):
            self.assertNotIn(name, schemas.AdminMatchRow.model_fields)
            self.assertIn(name, schemas.AdminMatchDetail.model_fields)


class QueryStringRoundTrip(TestCase):
    """The wire model and the dataclass are two hand-maintained field lists that
    ``from_query_params`` splats between. A name present in only one of them either
    raises on construction or, worse, drops a filter without a sound."""

    def _parse(self, query):
        wire = build_query_model(schemas.AdminMatchesQueryParams, query)
        return schemas.AdminMatchesSearchParams.from_query_params(wire)

    def test_every_filter_survives_the_gateway_encoding(self):
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
        self.assertEqual([LogProcessingStatus.failed, LogProcessingStatus.pending], params.log_status)
        self.assertTrue(params.unlinked_only)
        self.assertEqual(("ilios", 50), (params.query, params.per_page))

    def test_an_empty_query_string_filters_nothing(self):
        params = self._parse({})
        self.assertEqual([], params.log_status)
        self.assertFalse(params.unlinked_only)
        self.assertEqual([], svc._Query(1, params).provenance_predicates())


class DetailScoping(IsolatedAsyncioTestCase):
    async def test_a_missing_match_and_a_foreign_one_are_indistinguishable(self):
        """Both arrive here as "the scoped query matched nothing". If the two ever
        produced different messages, the endpoint would confirm which ids exist in
        other workspaces."""
        details = []
        for match_id in (999_999, 100):
            session = _ScriptedSession(None)
            with self.assertRaises(errors.BaseAPIException) as caught:
                await svc.matches_service.get_admin_match(session, workspace_id=1, match_id=match_id)
            self.assertEqual(404, caught.exception.status_code)
            details.append(caught.exception.detail)
        self.assertEqual(details[0], details[1])
        self.assertNotIn("100", str(details[0]), "the message must not echo the id back")

    async def test_the_lookup_is_workspace_scoped(self):
        """The 404 above only hides a foreign row because the query never selects
        it in the first place."""
        session = _ScriptedSession(None)
        with self.assertRaises(errors.BaseAPIException):
            await svc.matches_service.get_admin_match(session, workspace_id=42, match_id=100)
        self.assertIn("tournament.workspace_id", session.sql[0])

    async def test_counts_and_rounds_come_from_three_scans(self):
        session = _ScriptedSession(_match(), (18, 3), 400, 25)
        detail = await svc.matches_service.get_admin_match(session, workspace_id=1, match_id=100)
        self.assertEqual((18, 400, 25), (detail.statistics_count, detail.kill_feed_count, detail.event_count))
        self.assertEqual(3, detail.rounds)
        self.assertEqual(4, len(session.sql), "one row lookup plus one scan per stat table")
        for query in session.sql[1:]:
            self.assertIn("match_id", query, "each count must key on the indexed column")

    async def test_a_match_whose_stats_never_landed_reports_zero_rounds(self):
        """MAX over an empty table is NULL. Zero rounds is the finding — the log
        parsed and produced nothing — not missing information."""
        session = _ScriptedSession(_match(), (0, None), 0, 0)
        detail = await svc.matches_service.get_admin_match(session, workspace_id=1, match_id=100)
        self.assertEqual(0, detail.rounds)
        self.assertEqual(0, detail.statistics_count)
