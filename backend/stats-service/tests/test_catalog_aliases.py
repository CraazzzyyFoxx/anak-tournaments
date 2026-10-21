"""Catalog alias schema + alias-aware lookup contracts.

The parser used to translate log names through three hardcoded dicts in
``src/core/enums.py``. They now live in the database as ``aliases`` on the
catalog entities; these tests pin the shape that replaced them.
"""

from __future__ import annotations

import importlib
import sys
from pathlib import Path
from unittest import TestCase

backend_root = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(backend_root))
sys.path.insert(0, str(backend_root / "stats-service"))


shared_models = importlib.import_module("shared.models")


class CatalogAliasSchemaTests(TestCase):
    def test_catalog_entities_carry_a_non_nullable_jsonb_aliases_column(self) -> None:
        column = shared_models.CatalogEntity.__table__.c["aliases"]
        self.assertFalse(column.nullable, "CatalogEntity.aliases must be NOT NULL")
        self.assertEqual("JSONB", type(column.type).__name__)

    def test_alias_miss_kind_is_the_six_diagnostic_kinds_while_entities_stay_three(self) -> None:
        constraint = next(
            c
            for c in shared_models.CatalogAliasMiss.__table__.constraints
            if getattr(c, "name", None) == "ck_alias_miss_kind"
        )
        self.assertEqual("kind IN ('character', 'map', 'mode', 'stat', 'event', 'role')", str(constraint.sqltext))
        entity = next(
            c for c in shared_models.CatalogEntity.__table__.constraints if getattr(c, "name", None) == "ck_entity_kind"
        )
        self.assertEqual("kind IN ('character', 'map', 'mode')", str(entity.sqltext))

    def test_alias_miss_is_unique_per_entity_and_raw_name(self) -> None:
        table = shared_models.CatalogAliasMiss.__table__
        self.assertEqual("catalog", table.schema)
        constraint = next(c for c in table.constraints if getattr(c, "name", None) == "uq_alias_miss")
        self.assertEqual(["discipline", "kind", "raw_name"], [c.name for c in constraint.columns])

    def test_alias_miss_keeps_a_counter_and_a_resolution_stamp(self) -> None:
        columns = shared_models.CatalogAliasMiss.__table__.c
        self.assertFalse(columns["occurrences"].nullable)
        self.assertTrue(columns["resolved_at"].nullable)
        self.assertTrue(columns["last_ingest_job_id"].nullable)
