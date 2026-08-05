"""Catalog alias schema + alias-aware lookup contracts.

The parser used to translate log names through three hardcoded dicts in
``src/core/enums.py``. They now live in the database as ``aliases`` on the
catalog entities; these tests pin the shape that replaced them.
"""

from __future__ import annotations

import importlib
import os
import sys
from pathlib import Path
from unittest import TestCase

backend_root = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(backend_root))
sys.path.insert(0, str(backend_root / "parser-service"))

os.environ["DEBUG"] = "true"
os.environ.setdefault("PROJECT_URL", "http://localhost")
os.environ.setdefault("REDIS_URL", "redis://localhost:6379/0")
os.environ.setdefault("RABBITMQ_URL", "amqp://guest:guest@localhost:5672")
os.environ.setdefault("POSTGRES_USER", "postgres")
os.environ.setdefault("POSTGRES_PASSWORD", "postgres")
os.environ.setdefault("POSTGRES_DB", "postgres")
os.environ.setdefault("POSTGRES_HOST", "localhost")
os.environ.setdefault("POSTGRES_PORT", "5432")

shared_models = importlib.import_module("shared.models")
shared_enums = importlib.import_module("shared.core.enums")
repository = importlib.import_module("shared.repository")


class CatalogAliasSchemaTests(TestCase):
    def test_catalog_entities_carry_a_non_nullable_jsonb_aliases_column(self) -> None:
        for model in (shared_models.Hero, shared_models.Map, shared_models.Gamemode):
            column = model.__table__.c["aliases"]
            self.assertFalse(column.nullable, f"{model.__name__}.aliases must be NOT NULL")
            self.assertEqual("JSONB", type(column.type).__name__)

    def test_entity_type_enum_covers_the_three_catalog_entities(self) -> None:
        self.assertEqual(
            {"hero", "map", "gamemode"},
            {member.value for member in shared_enums.CatalogEntityType},
        )

    def test_alias_miss_is_unique_per_entity_and_raw_name(self) -> None:
        table = shared_models.CatalogAliasMiss.__table__
        self.assertEqual("overwatch", table.schema)
        constraint = next(
            c for c in table.constraints if getattr(c, "name", None) == "uq_catalog_alias_miss_entity_raw"
        )
        self.assertEqual(["entity_type", "raw_name"], [c.name for c in constraint.columns])

    def test_alias_miss_keeps_a_counter_and_a_resolution_stamp(self) -> None:
        columns = shared_models.CatalogAliasMiss.__table__.c
        self.assertFalse(columns["occurrences"].nullable)
        self.assertTrue(columns["resolved_at"].nullable)
        self.assertTrue(columns["last_log_record_id"].nullable)


class MapAliasLookupTests(TestCase):
    def test_map_lookup_matches_name_or_alias_for_both_map_and_gamemode(self) -> None:
        query = repository.MapRepository.build_name_or_alias_query(name="Илиос", gamemode="Контроль")
        sql = str(query.compile(compile_kwargs={"literal_binds": True}))

        self.assertIn("overwatch.map.name = 'Илиос'", sql)
        self.assertIn("overwatch.gamemode.name = 'Контроль'", sql)
        # One containment test per side: map.aliases and gamemode.aliases.
        self.assertEqual(2, sql.count("@>"), f"expected two JSONB containment predicates in:\n{sql}")

    def test_the_query_joins_the_gamemode_so_both_predicates_bind(self) -> None:
        query = repository.MapRepository.build_name_or_alias_query(name="Ilios", gamemode="Control")
        sql = str(query.compile(compile_kwargs={"literal_binds": True}))
        self.assertIn("JOIN overwatch.gamemode", sql)
