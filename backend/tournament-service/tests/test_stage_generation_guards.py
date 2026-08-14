"""Tests for the two admin/stage.py guards added alongside the bracket-generation
duplicate-match bug and the Draft-revert feature:

* ``generate_encounters`` must never insert a second set of matches on top of
  ones that already exist -- a grouped stage skips already-generated groups
  and only fills in new ones; a non-grouped stage refuses outright.
* ``deactivate_stage`` must only revert ``is_active``/``is_published`` back to
  Draft while every one of the stage's encounters is still OPEN -- the moment
  any encounter has been reported or started, it refuses instead of stranding
  real data behind a bracket that looks like a preview again.
"""

from __future__ import annotations

import importlib
import os
import sys
from pathlib import Path
from types import SimpleNamespace
from unittest import IsolatedAsyncioTestCase
from unittest.mock import AsyncMock, patch

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

enums = importlib.import_module("shared.core.enums")
errors = importlib.import_module("shared.core.errors")
stage_service = importlib.import_module("src.services.admin.stage")

HTTPException = errors.BaseAPIException


def _rows_result(rows: list[tuple]) -> SimpleNamespace:
    """Mimics ``Result.all()`` for the ``(stage_item_id, count)`` group-by."""
    return SimpleNamespace(all=lambda: rows)


def _scalar_result(value: int) -> SimpleNamespace:
    return SimpleNamespace(scalar_one=lambda: value)


def _item(item_id: int, name: str = "Group") -> SimpleNamespace:
    return SimpleNamespace(id=item_id, name=name)


class GenerateEncountersGuardTests(IsolatedAsyncioTestCase):
    async def test_grouped_stage_skips_items_that_already_have_matches(self) -> None:
        """Group A already has matches; Group B (newly added) does not -- only
        Group B gets generated, and Group A's existing matches are untouched."""
        item_a, item_b = _item(1, "Group A"), _item(2, "Group B")
        session = SimpleNamespace(execute=AsyncMock(return_value=_rows_result([(1, 10)])), flush=AsyncMock())
        stage = SimpleNamespace(id=77, tournament_id=1, stage_type=enums.StageType.SWISS, items=[item_a, item_b])
        new_encounter = SimpleNamespace(id=901)

        with (
            patch.object(stage_service, "get_stage", AsyncMock(return_value=stage)),
            patch.object(stage_service, "_collect_item_team_ids", lambda item: [10, 20]),
            patch.object(stage_service, "_generate_stage_skeleton", AsyncMock(return_value="skeleton")),
            patch.object(stage_service, "_load_team_names", AsyncMock(return_value={})),
            patch.object(
                stage_service, "_create_encounters_from_skeleton", AsyncMock(return_value=[new_encounter])
            ) as create,
            patch.object(stage_service, "enqueue_tournament_recalculation", AsyncMock()),
            patch.object(stage_service, "_publish_tournament_changed", AsyncMock()),
        ):
            result = await stage_service.generate_encounters(session, 77, commit=False)

        self.assertEqual([new_encounter], result)
        # Only Group B (item 2, the one with zero existing matches) was generated.
        self.assertEqual(1, create.await_count)
        self.assertEqual(item_b.id, create.await_args.args[3])

    async def test_grouped_stage_rejects_when_every_group_already_has_matches(self) -> None:
        item_a, item_b = _item(1, "Group A"), _item(2, "Group B")
        stage = SimpleNamespace(id=77, stage_type=enums.StageType.SWISS, items=[item_a, item_b])
        session = SimpleNamespace(execute=AsyncMock(return_value=_rows_result([(1, 10), (2, 10)])))

        with (
            patch.object(stage_service, "get_stage", AsyncMock(return_value=stage)),
            patch.object(
                stage_service, "_create_encounters_from_skeleton", AsyncMock()
            ) as create,
        ):
            with self.assertRaises(HTTPException) as ctx:
                await stage_service.generate_encounters(session, 77, commit=False)

        self.assertEqual(409, ctx.exception.status_code)
        create.assert_not_awaited()

    async def test_non_grouped_stage_rejects_regeneration_over_existing_matches(self) -> None:
        item = _item(1, "Bracket")
        stage = SimpleNamespace(id=88, stage_type=enums.StageType.SINGLE_ELIMINATION, items=[item])
        # One existing encounter already recorded against this stage.
        session = SimpleNamespace(execute=AsyncMock(return_value=_rows_result([(1, 8)])))

        with (
            patch.object(stage_service, "get_stage", AsyncMock(return_value=stage)),
            patch.object(
                stage_service, "_create_encounters_from_skeleton", AsyncMock()
            ) as create,
        ):
            with self.assertRaises(HTTPException) as ctx:
                await stage_service.generate_encounters(session, 88, commit=False)

        self.assertEqual(409, ctx.exception.status_code)
        create.assert_not_awaited()

    async def test_non_grouped_stage_still_generates_from_a_clean_slate(self) -> None:
        """Regression guard: a stage with zero existing encounters must still
        generate normally through the (now-guarded) non-grouped path."""
        item = _item(1, "Bracket")
        item.order = 0
        item.type = None
        stage = SimpleNamespace(
            id=99,
            tournament_id=1,
            stage_type=enums.StageType.SINGLE_ELIMINATION,
            items=[item],
            split_lower_bracket=False,
            settings_json={},
        )
        session = SimpleNamespace(execute=AsyncMock(return_value=_rows_result([])), flush=AsyncMock())
        new_encounters = [SimpleNamespace(id=1), SimpleNamespace(id=2)]

        with (
            patch.object(stage_service, "get_stage", AsyncMock(return_value=stage)),
            patch.object(stage_service, "_collect_item_team_ids", lambda item: [1, 2, 3, 4]),
            patch.object(stage_service, "_generate_stage_skeleton", AsyncMock(return_value="skeleton")),
            patch.object(stage_service, "_load_team_names", AsyncMock(return_value={})),
            patch.object(
                stage_service, "_create_encounters_from_skeleton", AsyncMock(return_value=new_encounters)
            ) as create,
            patch.object(stage_service, "enqueue_tournament_recalculation", AsyncMock()),
            patch.object(stage_service, "_publish_tournament_changed", AsyncMock()),
        ):
            result = await stage_service.generate_encounters(session, 99, commit=False)

        self.assertEqual(new_encounters, result)
        create.assert_awaited_once()


class DeactivateStageGuardTests(IsolatedAsyncioTestCase):
    async def test_reverts_an_untouched_stage_to_draft(self) -> None:
        stage = SimpleNamespace(id=5, tournament_id=1, is_active=True, is_published=True)
        session = SimpleNamespace(execute=AsyncMock(return_value=_scalar_result(0)), flush=AsyncMock())

        with (
            patch.object(stage_service, "get_stage", AsyncMock(side_effect=[stage, stage])),
            patch.object(stage_service, "_publish_tournament_changed", AsyncMock()) as notify,
        ):
            result = await stage_service.deactivate_stage(session, 5, commit=False)

        self.assertFalse(stage.is_active)
        self.assertFalse(stage.is_published)
        self.assertIs(stage, result)
        notify.assert_awaited_once()
        session.flush.assert_awaited_once()

    async def test_refuses_once_any_encounter_left_open(self) -> None:
        stage = SimpleNamespace(id=5, tournament_id=1, is_active=True, is_published=True)
        session = SimpleNamespace(execute=AsyncMock(return_value=_scalar_result(1)))

        with patch.object(stage_service, "get_stage", AsyncMock(return_value=stage)):
            with self.assertRaises(HTTPException) as ctx:
                await stage_service.deactivate_stage(session, 5, commit=False)

        self.assertEqual(409, ctx.exception.status_code)
        # Refused before mutating anything.
        self.assertTrue(stage.is_active)
        self.assertTrue(stage.is_published)
