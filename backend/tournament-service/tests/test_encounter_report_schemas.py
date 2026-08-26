"""Captain reports have a schema, and it is the same one everywhere.

The payload used to be a hand-rolled dict, so the public read documented as a
generic object and the admin list would have needed its own copy. These tests
pin the shape the frontend's ``CaptainReport`` type already consumes — adding a
field is fine, renaming or dropping one is not — and the series-score rule the
list uses to flag reports that cannot be right for their encounter's best_of.
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

captain_service = importlib.import_module("src.services.encounter.captain")
schemas = importlib.import_module("src.schemas")


class ValidSeriesScores(TestCase):
    """From docs/plans/encounter-best-of.md: w = floor(N/2)+1, maxLoser = N-w."""

    def test_best_of_one(self):
        self.assertEqual({(1, 0), (0, 1)}, schemas.valid_series_scores(1))

    def test_best_of_two_allows_the_draw(self):
        self.assertEqual({(2, 0), (1, 1), (0, 2)}, schemas.valid_series_scores(2))

    def test_best_of_three(self):
        self.assertEqual({(2, 0), (2, 1), (1, 2), (0, 2)}, schemas.valid_series_scores(3))

    def test_best_of_five(self):
        self.assertEqual(
            {(3, 0), (3, 1), (3, 2), (2, 3), (1, 3), (0, 3)},
            schemas.valid_series_scores(5),
        )

    def test_an_odd_series_cannot_be_drawn(self):
        for best_of in (1, 3, 5, 7):
            with self.subTest(best_of=best_of):
                self.assertNotIn((best_of // 2, best_of // 2), schemas.valid_series_scores(best_of))

    def test_a_score_beyond_the_series_is_invalid(self):
        self.assertNotIn((3, 0), schemas.valid_series_scores(3))

    def test_nonsense_best_of_yields_nothing_rather_than_raising(self):
        """Flagging is advisory; a bad best_of must not take the list down."""
        self.assertEqual(set(), schemas.valid_series_scores(0))


class SerializedShape(TestCase):
    def _report(self):
        encounter = SimpleNamespace(id=10, home_team_id=1, away_team_id=2)
        report = SimpleNamespace(
            id=5,
            encounter_id=10,
            team_id=2,
            reporter_user_id=77,
            home_score=1,
            away_score=2,
            closeness=8,
            comment="gg",
            custom_fields_json={"vod": "https://example.test/vod"},
            created_at=None,
            updated_at=None,
        )
        code = SimpleNamespace(id=1, map_index=1, map_id=55, code="AAA")
        return captain_service.serialize_captain_report(report, encounter, [code], reporter_name="cap")

    def test_keeps_the_contract_the_frontend_consumes(self):
        payload = self._report().model_dump(mode="json")
        self.assertEqual(
            {
                "id",
                "encounter_id",
                "team_id",
                "side",
                "reporter_user_id",
                "reporter_name",
                "home_score",
                "away_score",
                "closeness",
                "comment",
                "custom_fields",
                "map_codes",
                "created_at",
                "updated_at",
            },
            set(payload),
        )
        self.assertEqual({"id", "map_index", "map_id", "code"}, set(payload["map_codes"][0]))

    def test_side_is_derived_from_the_encounter_not_stored(self):
        """The report holds a team_id; which side that is depends on the
        encounter's orientation."""
        self.assertEqual("away", self._report().side)

    def test_map_codes_are_ordered_by_index(self):
        encounter = SimpleNamespace(id=10, home_team_id=1, away_team_id=2)
        report = SimpleNamespace(
            id=5,
            encounter_id=10,
            team_id=1,
            reporter_user_id=None,
            home_score=2,
            away_score=0,
            closeness=5,
            comment=None,
            custom_fields_json=None,
            created_at=None,
            updated_at=None,
        )
        codes = [
            SimpleNamespace(id=3, map_index=3, map_id=None, code="C"),
            SimpleNamespace(id=1, map_index=1, map_id=None, code="A"),
            SimpleNamespace(id=2, map_index=2, map_id=None, code="B"),
        ]
        out = captain_service.serialize_captain_report(report, encounter, codes)
        self.assertEqual([1, 2, 3], [c.map_index for c in out.map_codes])
