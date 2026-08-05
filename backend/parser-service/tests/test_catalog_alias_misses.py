"""Contracts of the unresolved-catalog-name queue writer.

Three things must hold, and none of them is visible from the happy path: the
upsert runs in its own committed transaction, a repeat occurrence increments the
counter and reopens a dismissed row, and a failure of the write itself is
swallowed so it can never replace the log-processing error it accompanies.
"""

from __future__ import annotations

import importlib
import os
import sys
from pathlib import Path
from unittest import IsolatedAsyncioTestCase
from unittest.mock import AsyncMock, patch

from sqlalchemy.dialects import postgresql

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

catalog_aliases = importlib.import_module("src.services.catalog_aliases")
shared_enums = importlib.import_module("shared.core.enums")


def _compile(statement) -> str:
    return str(statement.compile(dialect=postgresql.dialect()))


class MissUpsertStatementTests(IsolatedAsyncioTestCase):
    def test_a_repeat_occurrence_increments_the_counter_and_reopens_the_row(self) -> None:
        statement = catalog_aliases.build_miss_upsert(
            shared_enums.CatalogEntityType.map, ["Илиос", "Гавана"], log_record_id=None
        )
        sql = _compile(statement)

        self.assertIn("ON CONFLICT", sql)
        self.assertIn("uq_catalog_alias_miss_entity_raw", sql)
        on_conflict = sql.split("DO UPDATE")[1]
        self.assertIn("occurrences", on_conflict)
        self.assertIn("last_seen_at", on_conflict)
        self.assertIn("last_log_record_id", on_conflict)
        # Dismissed rows must reopen, not stay hidden while the name keeps arriving.
        self.assertIn("resolved_at", on_conflict)

    def test_it_writes_one_row_per_distinct_trimmed_name(self) -> None:
        statement = catalog_aliases.build_miss_upsert(
            shared_enums.CatalogEntityType.gamemode, ["Контроль", " Контроль ", "", "  ", "Битва"]
        )
        params = statement.compile(dialect=postgresql.dialect()).params
        raw_names = [value for key, value in params.items() if key.startswith("raw_name")]

        self.assertEqual(["Битва", "Контроль"], sorted(raw_names))

    def test_an_overlong_name_is_truncated_to_the_column_width(self) -> None:
        long_name = "Я" * (catalog_aliases.MISS_NAME_MAX_LENGTH + 40)
        statement = catalog_aliases.build_miss_upsert(shared_enums.CatalogEntityType.hero, [long_name])
        params = statement.compile(dialect=postgresql.dialect()).params
        raw_names = [value for key, value in params.items() if key.startswith("raw_name")]

        self.assertEqual([long_name[: catalog_aliases.MISS_NAME_MAX_LENGTH]], raw_names)


class RecordMissesTests(IsolatedAsyncioTestCase):
    async def test_it_upserts_in_its_own_session_and_commits(self) -> None:
        session = AsyncMock()
        session.__aenter__.return_value = session

        with patch.object(catalog_aliases.db, "async_session_maker", return_value=session) as factory:
            await catalog_aliases.record_misses(shared_enums.CatalogEntityType.hero, ["Ана"], log_record_id=7)

        factory.assert_called_once_with()
        session.execute.assert_awaited_once()
        # Without the commit the row dies with the rolled-back log-processing run.
        session.commit.assert_awaited_once()

    async def test_the_log_record_is_carried_into_the_row(self) -> None:
        session = AsyncMock()
        session.__aenter__.return_value = session

        with patch.object(catalog_aliases.db, "async_session_maker", return_value=session):
            await catalog_aliases.record_misses(shared_enums.CatalogEntityType.map, ["Хогвартс"], log_record_id=11)

        statement = session.execute.await_args.args[0]
        self.assertIn(11, statement.compile(dialect=postgresql.dialect()).params.values())

    async def test_an_empty_name_set_does_not_open_a_session(self) -> None:
        with patch.object(catalog_aliases.db, "async_session_maker") as factory:
            await catalog_aliases.record_misses(shared_enums.CatalogEntityType.hero, [])
            await catalog_aliases.record_misses(shared_enums.CatalogEntityType.hero, ["", "   "])

        factory.assert_not_called()

    async def test_a_failure_is_swallowed_so_it_cannot_mask_the_real_error(self) -> None:
        with patch.object(catalog_aliases.db, "async_session_maker", side_effect=RuntimeError("db down")):
            await catalog_aliases.record_misses(shared_enums.CatalogEntityType.hero, ["Ана"])

    async def test_a_failing_execute_is_swallowed_too(self) -> None:
        session = AsyncMock()
        session.__aenter__.return_value = session
        session.execute.side_effect = RuntimeError("deadlock")

        with patch.object(catalog_aliases.db, "async_session_maker", return_value=session):
            await catalog_aliases.record_misses(shared_enums.CatalogEntityType.map, ["Илиос"])

        session.commit.assert_not_awaited()
