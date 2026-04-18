from __future__ import annotations

import importlib
import os
import sys
from pathlib import Path
from unittest import TestCase

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

standings_service = importlib.import_module("src.services.standings.service")
models = importlib.import_module("src.models")
enums = importlib.import_module("shared.core.enums")


class StandingsServiceStageItemTests(TestCase):
    def test_group_stage_standings_include_assigned_teams_before_matches(self) -> None:
        tournament = models.Tournament(
            workspace_id=1,
            number=68,
            name="Tournament",
            is_league=False,
            win_points=1.0,
            draw_points=0.5,
            loss_points=0.0,
        )
        tournament.id = 99
        group = models.TournamentGroup(
            tournament_id=tournament.id,
            name="Group A",
            is_groups=True,
            stage_id=7,
        )
        group.id = 55
        tournament.groups = [group]

        stage = models.Stage(
            tournament_id=tournament.id,
            name="Group Stage",
            stage_type=enums.StageType.ROUND_ROBIN,
            order=0,
        )
        stage.id = 7
        stage_item = models.StageItem(
            stage_id=stage.id,
            name="Group A",
            type=enums.StageItemType.GROUP,
            order=0,
        )
        stage_item.id = 147
        stage_item.inputs = [
            models.StageItemInput(stage_item_id=stage_item.id, slot=1, team_id=10),
            models.StageItemInput(stage_item_id=stage_item.id, slot=2, team_id=20),
        ]

        standings = standings_service._build_group_stage_standings(
            tournament,
            stage,
            stage_item,
            [],
        )

        self.assertEqual([10, 20], [standing.team_id for standing in standings])
        self.assertEqual([1, 2], [standing.position for standing in standings])
        self.assertEqual([0, 0], [standing.matches for standing in standings])
        self.assertEqual([0.0, 0.0], [standing.points for standing in standings])
        self.assertEqual([stage_item.id, stage_item.id], [
            standing.stage_item_id for standing in standings
        ])
