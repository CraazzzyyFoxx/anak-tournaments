from __future__ import annotations

import importlib
import os
import sys
from pathlib import Path
from types import SimpleNamespace
from unittest import IsolatedAsyncioTestCase, TestCase
from unittest.mock import AsyncMock, patch

backend_root = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(backend_root))
sys.path.insert(0, str(backend_root / "parser-service"))

os.environ.setdefault("PROJECT_URL", "http://localhost")
os.environ.setdefault("REDIS_URL", "redis://localhost:6379/0")
os.environ.setdefault("RABBITMQ_URL", "amqp://guest:guest@localhost:5672")
os.environ.setdefault("POSTGRES_USER", "postgres")
os.environ.setdefault("POSTGRES_PASSWORD", "postgres")
os.environ.setdefault("POSTGRES_DB", "postgres")
os.environ.setdefault("POSTGRES_HOST", "localhost")
os.environ.setdefault("POSTGRES_PORT", "5432")

enums = importlib.import_module("shared.core.enums")
swiss_auto_round = importlib.import_module("src.services.standings.swiss_auto_round")


class SwissAutoRoundTests(TestCase):
    @staticmethod
    def _encounter(
        *,
        home_team_id: int | None,
        away_team_id: int | None,
        round_number: int,
        status: enums.EncounterStatus,
    ) -> SimpleNamespace:
        return SimpleNamespace(
            home_team_id=home_team_id,
            away_team_id=away_team_id,
            round=round_number,
            status=status,
            result_status=enums.EncounterResultStatus.NONE,
        )

    def test_stage_item_is_not_ready_while_current_round_is_incomplete(self) -> None:
        encounters = [
            self._encounter(
                home_team_id=1,
                away_team_id=2,
                round_number=1,
                status=enums.EncounterStatus.COMPLETED,
            ),
            self._encounter(
                home_team_id=3,
                away_team_id=4,
                round_number=1,
                status=enums.EncounterStatus.COMPLETED,
            ),
            self._encounter(
                home_team_id=1,
                away_team_id=3,
                round_number=2,
                status=enums.EncounterStatus.COMPLETED,
            ),
            self._encounter(
                home_team_id=2,
                away_team_id=4,
                round_number=2,
                status=enums.EncounterStatus.OPEN,
            ),
        ]

        self.assertFalse(swiss_auto_round._stage_item_ready_for_next_round(encounters))

    def test_stage_item_is_ready_after_full_round_completion(self) -> None:
        encounters = [
            self._encounter(
                home_team_id=1,
                away_team_id=2,
                round_number=1,
                status=enums.EncounterStatus.COMPLETED,
            ),
            self._encounter(
                home_team_id=3,
                away_team_id=4,
                round_number=1,
                status=enums.EncounterStatus.COMPLETED,
            ),
        ]

        self.assertTrue(swiss_auto_round._stage_item_ready_for_next_round(encounters))


class SwissAutoRoundIsolationTests(IsolatedAsyncioTestCase):
    @staticmethod
    def _stage(stage_id: int, item_ids: list[int]) -> SimpleNamespace:
        return SimpleNamespace(
            id=stage_id,
            items=[SimpleNamespace(id=item_id) for item_id in item_ids],
        )

    @staticmethod
    def _encounter(
        *,
        stage_id: int,
        stage_item_id: int | None,
        home_team_id: int | None,
        away_team_id: int | None,
        round_number: int,
        status: enums.EncounterStatus,
    ) -> SimpleNamespace:
        return SimpleNamespace(
            stage_id=stage_id,
            stage_item_id=stage_item_id,
            home_team_id=home_team_id,
            away_team_id=away_team_id,
            round=round_number,
            status=status,
            result_status=enums.EncounterResultStatus.NONE,
        )

    async def test_enqueue_swiss_next_rounds_handles_stage_items_independently(self) -> None:
        stage = self._stage(77, [501, 502])
        stage.is_active = True
        stage.is_completed = False

        class _StageResult:
            def scalars(self) -> SimpleNamespace:
                return SimpleNamespace(all=lambda: [stage])

        encounters = [
            self._encounter(
                stage_id=stage.id,
                stage_item_id=501,
                home_team_id=1,
                away_team_id=2,
                round_number=1,
                status=enums.EncounterStatus.COMPLETED,
            ),
            self._encounter(
                stage_id=stage.id,
                stage_item_id=501,
                home_team_id=3,
                away_team_id=4,
                round_number=1,
                status=enums.EncounterStatus.COMPLETED,
            ),
            self._encounter(
                stage_id=stage.id,
                stage_item_id=501,
                home_team_id=1,
                away_team_id=3,
                round_number=2,
                status=enums.EncounterStatus.COMPLETED,
            ),
            self._encounter(
                stage_id=stage.id,
                stage_item_id=501,
                home_team_id=2,
                away_team_id=4,
                round_number=2,
                status=enums.EncounterStatus.OPEN,
            ),
            self._encounter(
                stage_id=stage.id,
                stage_item_id=502,
                home_team_id=11,
                away_team_id=12,
                round_number=1,
                status=enums.EncounterStatus.COMPLETED,
            ),
            self._encounter(
                stage_id=stage.id,
                stage_item_id=502,
                home_team_id=13,
                away_team_id=14,
                round_number=1,
                status=enums.EncounterStatus.COMPLETED,
            ),
        ]

        class _EncounterResult:
            def scalars(self) -> SimpleNamespace:
                return SimpleNamespace(all=lambda: encounters)

        session = SimpleNamespace(
            execute=AsyncMock(side_effect=[_StageResult(), _EncounterResult()])
        )

        with patch.object(swiss_auto_round, "publish_message", AsyncMock()) as publish_message:
            events = await swiss_auto_round.enqueue_swiss_next_rounds(
                session,
                tournament_id=999,
                broker=SimpleNamespace(),
            )

        self.assertEqual(1, len(events))
        self.assertEqual(502, events[0].stage_item_id)
        self.assertEqual(2, events[0].next_round)
        publish_message.assert_awaited_once()

    async def test_enqueue_swiss_next_rounds_checks_stages_completed_by_recalculation(self) -> None:
        stage = self._stage(78, [601])
        stage.is_active = True
        stage.is_completed = True
        stage.max_rounds = 5

        class _StageResult:
            def scalars(self) -> SimpleNamespace:
                return SimpleNamespace(all=lambda: [stage])

        encounters = [
            self._encounter(
                stage_id=stage.id,
                stage_item_id=601,
                home_team_id=1,
                away_team_id=2,
                round_number=1,
                status=enums.EncounterStatus.COMPLETED,
            ),
            self._encounter(
                stage_id=stage.id,
                stage_item_id=601,
                home_team_id=3,
                away_team_id=4,
                round_number=1,
                status=enums.EncounterStatus.COMPLETED,
            ),
        ]

        class _EncounterResult:
            def scalars(self) -> SimpleNamespace:
                return SimpleNamespace(all=lambda: encounters)

        async def execute(query):
            query_text = str(query).lower()
            if not hasattr(execute, "seen_stage_query"):
                execute.seen_stage_query = True
                self.assertNotIn("tournament.stage.is_completed = false", query_text)
                return _StageResult()
            return _EncounterResult()

        session = SimpleNamespace(execute=AsyncMock(side_effect=execute))

        with patch.object(swiss_auto_round, "publish_message", AsyncMock()) as publish_message:
            events = await swiss_auto_round.enqueue_swiss_next_rounds(
                session,
                tournament_id=999,
                broker=SimpleNamespace(),
            )

        self.assertEqual(1, len(events))
        self.assertEqual(601, events[0].stage_item_id)
        self.assertEqual(2, events[0].next_round)
        publish_message.assert_awaited_once()

    async def test_enqueue_swiss_next_rounds_stops_at_stage_max_rounds(self) -> None:
        stage = self._stage(79, [701])
        stage.is_active = True
        stage.is_completed = False
        stage.max_rounds = 2

        class _StageResult:
            def scalars(self) -> SimpleNamespace:
                return SimpleNamespace(all=lambda: [stage])

        encounters = [
            self._encounter(
                stage_id=stage.id,
                stage_item_id=701,
                home_team_id=1,
                away_team_id=2,
                round_number=1,
                status=enums.EncounterStatus.COMPLETED,
            ),
            self._encounter(
                stage_id=stage.id,
                stage_item_id=701,
                home_team_id=3,
                away_team_id=4,
                round_number=1,
                status=enums.EncounterStatus.COMPLETED,
            ),
            self._encounter(
                stage_id=stage.id,
                stage_item_id=701,
                home_team_id=1,
                away_team_id=3,
                round_number=2,
                status=enums.EncounterStatus.COMPLETED,
            ),
            self._encounter(
                stage_id=stage.id,
                stage_item_id=701,
                home_team_id=2,
                away_team_id=4,
                round_number=2,
                status=enums.EncounterStatus.COMPLETED,
            ),
        ]

        class _EncounterResult:
            def scalars(self) -> SimpleNamespace:
                return SimpleNamespace(all=lambda: encounters)

        session = SimpleNamespace(
            execute=AsyncMock(side_effect=[_StageResult(), _EncounterResult()])
        )

        with patch.object(swiss_auto_round, "publish_message", AsyncMock()) as publish_message:
            events = await swiss_auto_round.enqueue_swiss_next_rounds(
                session,
                tournament_id=999,
                broker=SimpleNamespace(),
            )

        self.assertEqual([], events)
        publish_message.assert_not_awaited()
