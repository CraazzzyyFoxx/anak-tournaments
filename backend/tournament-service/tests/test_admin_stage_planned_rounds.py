"""`get_planned_rounds` must offer the round numbers a bracket stage actually
has, or will have -- never the linear `1..max_rounds` guess the round picker
used before this, which double elimination's negative lower-bracket rounds
(and single elimination's team-count-dependent round count) can silently
disagree with.

Does not touch a real database: `get_stage` is patched directly (the
established pattern in this test suite, see `test_admin_stage_merge.py`), and
`session.execute` is mocked only for the distinct-encounter-rounds query
`get_planned_rounds` runs itself.
"""

from __future__ import annotations

import importlib
import os
import sys
from pathlib import Path
from types import SimpleNamespace
from unittest import IsolatedAsyncioTestCase
from unittest.mock import AsyncMock, Mock, patch

backend_root = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(backend_root))
sys.path.insert(0, str(backend_root / "tournament-service"))

os.environ["DEBUG"] = "true"
os.environ.setdefault("PROJECT_URL", "http://localhost")
os.environ.setdefault("REDIS_URL", "redis://localhost:6379/0")
os.environ.setdefault("RABBITMQ_URL", "amqp://guest:guest@localhost:5672")
os.environ.setdefault("POSTGRES_USER", "postgres")
os.environ.setdefault("POSTGRES_PASSWORD", "postgres")
os.environ.setdefault("POSTGRES_DB", "postgres")
os.environ.setdefault("POSTGRES_HOST", "localhost")
os.environ.setdefault("POSTGRES_PORT", "5432")

stage_service = importlib.import_module("src.services.admin.stage")
enums = importlib.import_module("shared.core.enums")


def _rows_result(rows: list[tuple]):
    result = Mock()
    result.all.return_value = rows
    return result


def _input(team_id: int | None, slot: int) -> SimpleNamespace:
    return SimpleNamespace(team_id=team_id, slot=slot)


def _item(item_id: int, inputs: list[SimpleNamespace], order: int = 0) -> SimpleNamespace:
    return SimpleNamespace(id=item_id, order=order, inputs=inputs)


class GetPlannedRoundsTests(IsolatedAsyncioTestCase):
    async def test_returns_existing_rounds_once_the_bracket_is_built(self) -> None:
        stage = SimpleNamespace(id=5, stage_type=enums.StageType.DOUBLE_ELIMINATION, items=[])
        session = SimpleNamespace(execute=AsyncMock(return_value=_rows_result([(1,), (-2,), (2,)])))

        with patch.object(stage_service, "get_stage", AsyncMock(return_value=stage)):
            rounds = await stage_service.get_planned_rounds(session, 5)

        # Ground truth once encounters exist: sorted, never re-predicted.
        self.assertEqual([-2, 1, 2], rounds)

    async def test_predicts_double_elimination_rounds_from_planned_team_inputs(self) -> None:
        inputs = [_input(team_id, team_id) for team_id in range(1, 9)]
        stage = SimpleNamespace(
            id=5,
            stage_type=enums.StageType.DOUBLE_ELIMINATION,
            items=[_item(1, inputs)],
            split_lower_bracket=False,
        )
        session = SimpleNamespace(execute=AsyncMock(return_value=_rows_result([])))

        with patch.object(stage_service, "get_stage", AsyncMock(return_value=stage)):
            rounds = await stage_service.get_planned_rounds(session, 5)

        self.assertEqual([-4, -3, -2, -1, 1, 2, 3, 4], rounds)

    async def test_includes_still_tentative_inputs_in_the_predicted_team_count(self) -> None:
        # `_collect_item_team_ids` only checks `team_id is not None`; a
        # TENTATIVE input (not yet resolved to FINAL) still counts.
        inputs = [
            _input(1, 1),
            _input(2, 2),
            _input(None, 3),
            _input(3, 4),
            _input(4, 5),
        ]
        stage = SimpleNamespace(
            id=5, stage_type=enums.StageType.SINGLE_ELIMINATION, items=[_item(1, inputs)]
        )
        session = SimpleNamespace(execute=AsyncMock(return_value=_rows_result([])))

        with patch.object(stage_service, "get_stage", AsyncMock(return_value=stage)):
            rounds = await stage_service.get_planned_rounds(session, 5)

        self.assertEqual([1, 2], rounds)  # 4 known teams -> 2 rounds

    async def test_predicts_nothing_for_a_non_bracket_stage_type(self) -> None:
        stage = SimpleNamespace(
            id=5,
            stage_type=enums.StageType.SWISS,
            items=[_item(1, [_input(1, 1), _input(2, 2)])],
        )
        session = SimpleNamespace(execute=AsyncMock(return_value=_rows_result([])))

        with patch.object(stage_service, "get_stage", AsyncMock(return_value=stage)):
            rounds = await stage_service.get_planned_rounds(session, 5)

        self.assertEqual([], rounds)

    async def test_predicts_nothing_with_fewer_than_two_teams_wired_in(self) -> None:
        stage = SimpleNamespace(
            id=5,
            stage_type=enums.StageType.SINGLE_ELIMINATION,
            items=[_item(1, [_input(1, 1)])],
        )
        session = SimpleNamespace(execute=AsyncMock(return_value=_rows_result([])))

        with patch.object(stage_service, "get_stage", AsyncMock(return_value=stage)):
            rounds = await stage_service.get_planned_rounds(session, 5)

        self.assertEqual([], rounds)
