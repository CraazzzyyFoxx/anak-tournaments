from __future__ import annotations

import os
import sys
from pathlib import Path
from unittest import TestCase

import sqlalchemy as sa

backend_root = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(backend_root))
sys.path.insert(0, str(backend_root / "tournament-service"))

os.environ["DEBUG"] = "true"

from shared import models  # noqa: E402
from src import schemas  # noqa: E402


class EncounterListSortTests(TestCase):
    def _compile(self, sort: str) -> str:
        params = schemas.EncounterSearchParams(sort=sort, order="asc", per_page=15)
        query = params.apply_pagination_sort(sa.select(models.Encounter), models.Encounter)
        return str(query.compile(dialect=sa.dialects.postgresql.dialect()))

    def test_has_logs_sort_targets_the_derived_expression(self) -> None:
        # ``has_logs`` is a ``column_property`` (EXISTS over matches.match), so a
        # textual ``ORDER BY has_logs`` would hit UndefinedColumnError.
        sql = self._compile("has_logs")
        self.assertNotIn("ORDER BY has_logs", sql)
        self.assertIn("ORDER BY anon_1", sql)
        self.assertIn("AS anon_1", sql)

    def test_plain_column_sort_still_works(self) -> None:
        self.assertIn("ORDER BY tournament.encounter.closeness ASC", self._compile("closeness"))
