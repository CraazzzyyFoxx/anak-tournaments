from __future__ import annotations

import importlib
import os
import sys
from pathlib import Path
from types import SimpleNamespace
from unittest import IsolatedAsyncioTestCase, TestCase

import sqlalchemy as sa
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

backend_root = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(backend_root))
sys.path.insert(0, str(backend_root / "parser-service"))

os.environ["DEBUG"] = "true"

enums = importlib.import_module("src.core.enums")
flows = importlib.import_module("src.services.match_logs.flows")
models = importlib.import_module("src.models")
from shared.repository.stats import _bulk_insert


class MatchLogParserTests(TestCase):
    def test_wide_player_stat_row_is_not_truncated_or_shifted(self) -> None:
        job = SimpleNamespace(filename="match.log", discipline="overwatch")
        stat_payload = [
            "1",
            "Blue Team",
            "Player One",
            "Ana",
            *[str(index) for index in range(33)],
        ]
        line = ",".join(["2026-04-19T12:00:00Z", "player_stat", "12.5", *stat_payload])

        processor = flows.MatchLogProcessor(job, [line])

        rows = processor._get_rows(enums.LogEventType.PlayerStat)
        self.assertEqual(1, len(rows))
        self.assertEqual(stat_payload, rows.iloc[0]["data"])

    def test_quoted_commas_and_type_index_survive_batched_csv_parse(self) -> None:
        job = SimpleNamespace(filename="match.log", discipline="overwatch")
        lines = [
            "2026-04-19T12:00:00Z,meta,0,ignored",
            '2026-04-19T12:00:00Z,match_start,0.0,Ilios,"Control","Team, A","Team, B"',
            "2026-04-19T12:00:00Z,not_a_real_event,1.0,x",
            "2026-04-19T12:00:00Z,kill,12.5,Team A,Ana,Ana,Team B,Mercy,Mercy,0,100,False,False",
        ]
        processor = flows.MatchLogProcessor(job, lines)

        starts = processor._get_rows(enums.LogEventType.MatchStart)
        self.assertEqual(1, len(starts))
        self.assertEqual(["Ilios", "Control", "Team, A", "Team, B"], starts.iloc[0]["data"])
        self.assertEqual(1, len(processor._get_rows(enums.LogEventType.Kill)))
        self.assertTrue(processor._get_rows(enums.LogEventType.PlayerStat).empty)


class BulkInsertTests(IsolatedAsyncioTestCase):
    """The native Core writer retains explicit NULL entity keys in one batch."""

    async def test_rows_with_and_without_hero_share_one_statement(self) -> None:
        engine = sa.create_engine("sqlite://", poolclass=StaticPool, connect_args={"check_same_thread": False})
        statements: list[tuple[str, bool]] = []

        @sa.event.listens_for(engine, "before_cursor_execute")
        def _record(_conn, _cursor, statement, _params, _ctx, executemany):  # noqa: ANN001, ANN202
            statements.append((statement, executemany))

        with engine.begin() as conn:
            conn.exec_driver_sql("ATTACH DATABASE ':memory:' AS stats")
            conn.exec_driver_sql(
                "CREATE TABLE stats.fact (match_id BIGINT, segment INTEGER, encounter_team_id BIGINT,"
                " workspace_member_id BIGINT, entity_id BIGINT, entity_kind VARCHAR, stat_id BIGINT, value FLOAT)"
            )
        statements.clear()

        rows = [
            {
                "match_id": 1,
                "segment": 1,
                "encounter_team_id": 2,
                "workspace_member_id": 3,
                "entity_id": None,
                "stat_id": stat_id,
                "value": value,
            }
            for stat_id, value in ((1, 4.0), (2, 1.0))
        ]
        rows.insert(1, {**rows[0], "entity_id": 9, "stat_id": 3, "value": 60.0})

        with Session(engine) as session:
            await _bulk_insert(SimpleNamespace(execute=_sync_execute(session)), models.StatsFact, rows)
            session.commit()
            stored = session.execute(
                sa.select(models.StatsFact.entity_id, models.StatsFact.value).order_by(models.StatsFact.value)
            ).all()

        self.assertEqual([(None, 1.0), (None, 4.0), (9, 60.0)], [(hero_id, value) for hero_id, value in stored])
        inserts = [(statement, many) for statement, many in statements if statement.lstrip().startswith("INSERT")]
        self.assertEqual(1, len(inserts), inserts)
        self.assertTrue(inserts[0][1], "the batch must go out as one executemany")
        self.assertIn("entity_id", inserts[0][0])


def _sync_execute(session: Session):  # noqa: ANN202
    async def execute(statement, params=None):  # noqa: ANN001, ANN202
        return session.execute(statement, params)

    return execute
