"""Derivations behind the reports list.

The SQL half of this feature was exercised against a real Postgres (§14 of the
design doc); what those runs cannot pin is the row-level reasoning: how a report
is assigned to a side, when "the sides agree" is knowable at all, and which
filters the stats endpoint is supposed to ignore. That is what these cover.
"""

from __future__ import annotations

import importlib
import os
import sys
from pathlib import Path
from types import SimpleNamespace
from unittest import TestCase

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

svc = importlib.import_module("src.services.admin.encounter_reports")
schemas = importlib.import_module("src.schemas.admin.encounter_reports")
enums = importlib.import_module("shared.core.enums")


def _report(team_id: int, home: int, away: int, *, report_id: int = 1):
    return SimpleNamespace(
        id=report_id,
        encounter_id=10,
        team_id=team_id,
        reporter_user_id=None,
        reporter=None,
        home_score=home,
        away_score=away,
        closeness=5,
        map_codes=[],
        created_at=None,
        updated_at=None,
    )


def _encounter(reports, *, best_of: int = 3, home_team_id: int = 1, away_team_id: int = 2):
    return SimpleNamespace(
        id=10,
        name="A vs B",
        tournament_id=3,
        tournament=SimpleNamespace(name="Cup"),
        stage=SimpleNamespace(name="Groups"),
        stage_item=None,
        round=1,
        best_of=best_of,
        status=enums.EncounterStatus.COMPLETED,
        result_status=enums.EncounterResultStatus.CONFIRMED,
        scheduled_at=None,
        home_team_id=home_team_id,
        away_team_id=away_team_id,
        home_team=SimpleNamespace(id=home_team_id, name="A"),
        away_team=SimpleNamespace(id=away_team_id, name="B"),
        captain_reports=reports,
    )


class ScoresMatchIsThreeValued(TestCase):
    """`None` is not `False`. "Only one side answered" must not render as a
    disagreement — that is the difference between chasing a captain and
    adjudicating a dispute."""

    def test_undecided_with_no_reports(self):
        row = svc._row(_encounter([]), 0, None, None)
        self.assertIsNone(row.scores_match)

    def test_undecided_with_one_report(self):
        row = svc._row(_encounter([_report(1, 2, 1)]), 1, 1, None)
        self.assertIsNone(row.scores_match)

    def test_true_when_both_agree(self):
        reports = [_report(1, 2, 1), _report(2, 2, 1, report_id=2)]
        row = svc._row(_encounter(reports), 2, 1, None)
        self.assertIs(True, row.scores_match)

    def test_false_when_both_reported_and_differ(self):
        reports = [_report(1, 2, 1), _report(2, 0, 2, report_id=2)]
        row = svc._row(_encounter(reports), 2, 2, None)
        self.assertIs(False, row.scores_match)


class SideAssignment(TestCase):
    def test_reports_land_on_the_encounter_orientation(self):
        home, away = _report(1, 2, 1), _report(2, 2, 1, report_id=2)
        row = svc._row(_encounter([away, home]), 2, 1, None)
        self.assertEqual(home.id, row.home_report.id)
        self.assertEqual(away.id, row.away_report.id)
        self.assertEqual("home", row.home_report.side)
        self.assertEqual("away", row.away_report.side)

    def test_a_report_from_neither_team_occupies_no_slot(self):
        """Possible after an admin swaps an encounter's teams: the stale report
        must not be silently displayed as one of the two sides."""
        row = svc._row(_encounter([_report(99, 2, 1)]), 1, 1, None)
        self.assertIsNone(row.home_report)
        self.assertIsNone(row.away_report)
        self.assertEqual(1, row.reported_count)

    def test_an_unfilled_bracket_slot_has_no_side_reports(self):
        encounter = _encounter([_report(1, 2, 1)], away_team_id=None)
        encounter.away_team = None
        row = svc._row(encounter, 1, 1, None)
        self.assertIsNone(row.away_team)
        self.assertIsNone(row.away_report)


class SeriesValidityIsAdvisory(TestCase):
    def test_flags_a_score_impossible_for_the_series(self):
        row = svc._row(_encounter([_report(1, 3, 0)], best_of=3), 1, 1, None)
        self.assertFalse(row.series_score_valid)

    def test_accepts_a_legitimate_score(self):
        row = svc._row(_encounter([_report(1, 2, 1)], best_of=3), 1, 1, None)
        self.assertTrue(row.series_score_valid)

    def test_no_reports_is_not_a_violation(self):
        """Nothing contradicts the series length, and a warning nobody can act
        on is noise."""
        self.assertTrue(svc._row(_encounter([], best_of=3), 0, None, None).series_score_valid)

    def test_a_nonsense_best_of_does_not_condemn_every_row(self):
        """Legacy rows carry best_of=0. Flagging all of them would bury the real
        mismatches."""
        self.assertTrue(svc._row(_encounter([_report(1, 2, 1)], best_of=0), 1, 1, None).series_score_valid)

    def test_one_bad_report_flags_the_row(self):
        reports = [_report(1, 2, 1), _report(2, 5, 5, report_id=2)]
        self.assertFalse(svc._row(_encounter(reports), 2, 2, None).series_score_valid)


class FilterPartitioning(TestCase):
    """The stats endpoint applies scope but not chips, so a chip counts what it
    *would* select. Applying its own filter would zero every other chip the
    moment one is clicked."""

    def _params(self, **kw):
        params = schemas.EncounterReportsSearchParams(page=1, per_page=25)
        for key, value in kw.items():
            setattr(params, key, value)
        return params

    def test_chip_filters_are_not_scope(self):
        params = self._params(
            tournament_id=7,
            mismatch_only=True,
            reported_count=2,
            result_status=[enums.EncounterResultStatus.DISPUTED],
        )
        builder = svc._Query(1, params)
        self.assertEqual(2, len(builder.scope_predicates()), "workspace + tournament only")
        self.assertEqual(3, len(builder.chip_predicates()))

    def test_workspace_is_always_scoped(self):
        """A missing workspace filter would leak another tenant's encounters."""
        builder = svc._Query(1, self._params())
        self.assertEqual(1, len(builder.scope_predicates()))
        self.assertEqual([], builder.chip_predicates())

    def test_zero_reports_matches_the_absent_aggregate_row(self):
        """No report rows means no GROUP BY row at all, so the count is NULL —
        `= 0` would match nothing."""
        builder = svc._Query(1, self._params(reported_count=0))
        predicate = str(builder.chip_predicates()[0])
        self.assertIn("IS NULL", predicate)

    def test_a_nonzero_count_compares_the_aggregate(self):
        builder = svc._Query(1, self._params(reported_count=2))
        self.assertNotIn("IS NULL", str(builder.chip_predicates()[0]))

    def test_search_covers_both_team_names_and_the_encounter(self):
        builder = svc._Query(1, self._params(query="dragons"))
        predicate = str(builder.scope_predicates()[-1]).lower()
        for expected in ("encounter.name", "home_team.name", "away_team.name"):
            self.assertIn(expected, predicate)
