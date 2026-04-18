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
sys.path.insert(0, str(backend_root / "parser-service"))

os.environ.setdefault("PROJECT_URL", "http://localhost")
os.environ.setdefault("REDIS_URL", "redis://localhost:6379/0")
os.environ.setdefault("POSTGRES_USER", "postgres")
os.environ.setdefault("POSTGRES_PASSWORD", "postgres")
os.environ.setdefault("POSTGRES_DB", "postgres")
os.environ.setdefault("POSTGRES_HOST", "localhost")
os.environ.setdefault("POSTGRES_PORT", "5432")
os.environ.setdefault("S3_ACCESS_KEY", "test")
os.environ.setdefault("S3_SECRET_KEY", "test")
os.environ.setdefault("S3_ENDPOINT_URL", "http://localhost")
os.environ.setdefault("S3_BUCKET_NAME", "test")

stage_service = importlib.import_module("src.services.admin.stage")
admin_schemas = importlib.import_module("src.schemas.admin.stage")
enums = importlib.import_module("shared.core.enums")


class AdminStageServiceTests(IsolatedAsyncioTestCase):
    async def test_generate_round_robin_encounters_per_group_item(self) -> None:
        stage = SimpleNamespace(
            id=7,
            tournament_id=99,
            stage_type=enums.StageType.ROUND_ROBIN,
            items=[
                SimpleNamespace(
                    id=10,
                    inputs=[
                        SimpleNamespace(slot=1, team_id=1),
                        SimpleNamespace(slot=2, team_id=2),
                    ],
                ),
                SimpleNamespace(
                    id=11,
                    inputs=[
                        SimpleNamespace(slot=1, team_id=3),
                        SimpleNamespace(slot=2, team_id=4),
                    ],
                ),
            ],
        )
        session = SimpleNamespace(add=Mock(), commit=AsyncMock())

        with patch.object(stage_service, "get_stage", AsyncMock(return_value=stage)):
            encounters = await stage_service.generate_encounters(session, stage.id)

        self.assertEqual(2, len(encounters))
        self.assertEqual([10, 11], [encounter.stage_item_id for encounter in encounters])
        self.assertEqual([(1, 2), (3, 4)], [
            (encounter.home_team_id, encounter.away_team_id)
            for encounter in encounters
        ])
        session.commit.assert_awaited_once_with()

    async def test_create_stage_item_creates_compat_group_and_recalculates_standings(self) -> None:
        stage = SimpleNamespace(
            id=7,
            tournament_id=99,
            stage_type=enums.StageType.ROUND_ROBIN,
        )
        existing_group_result = Mock()
        existing_group_result.scalar_one_or_none.return_value = None
        session = SimpleNamespace(
            execute=AsyncMock(return_value=existing_group_result),
            add=Mock(side_effect=lambda item: setattr(item, "id", getattr(item, "id", 123))),
            commit=AsyncMock(),
        )
        data = admin_schemas.StageItemCreate(
            name="Group A",
            type=enums.StageItemType.GROUP,
            order=0,
        )

        with (
            patch.object(stage_service, "get_stage", AsyncMock(return_value=stage)),
            patch.object(stage_service, "get_stage_item", AsyncMock(return_value="created")),
            patch.object(
                stage_service.standings_service,
                "recalculate_for_tournament",
                AsyncMock(),
            ) as recalculate,
        ):
            result = await stage_service.create_stage_item(session, stage.id, data)

        self.assertEqual("created", result)
        added_group = session.add.call_args_list[1].args[0]
        self.assertEqual("Group A", added_group.name)
        self.assertEqual(stage.id, added_group.stage_id)
        self.assertTrue(added_group.is_groups)
        recalculate.assert_awaited_once_with(session, stage.tournament_id)
