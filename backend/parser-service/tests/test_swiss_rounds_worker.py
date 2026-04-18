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

os.environ["DEBUG"] = "true"
os.environ.setdefault("PROJECT_URL", "http://localhost")
os.environ.setdefault("REDIS_URL", "redis://localhost:6379/0")
os.environ.setdefault("RABBITMQ_URL", "amqp://guest:guest@localhost:5672")
os.environ.setdefault("POSTGRES_USER", "postgres")
os.environ.setdefault("POSTGRES_PASSWORD", "postgres")
os.environ.setdefault("POSTGRES_DB", "postgres")
os.environ.setdefault("POSTGRES_HOST", "localhost")
os.environ.setdefault("POSTGRES_PORT", "5432")
os.environ.setdefault("S3_ACCESS_KEY", "test")
os.environ.setdefault("S3_SECRET_KEY", "test")
os.environ.setdefault("S3_ENDPOINT_URL", "http://localhost")
os.environ.setdefault("S3_BUCKET_NAME", "test")
os.environ.setdefault("CHALLONGE_USERNAME", "test")
os.environ.setdefault("CHALLONGE_API_KEY", "test")

enums = importlib.import_module("shared.core.enums")
events = importlib.import_module("shared.schemas.events")
swiss_rounds = importlib.import_module("src.services.admin.swiss_rounds")


class SwissRoundWorkerTests(IsolatedAsyncioTestCase):
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

    async def test_generate_next_round_skips_stale_event_when_current_item_round_is_open(self) -> None:
        event = events.SwissNextRoundEvent(
            tournament_id=999,
            stage_id=77,
            stage_item_id=501,
        )
        stage_item = SimpleNamespace(id=501)
        stage = SimpleNamespace(
            id=77,
            is_active=True,
            items=[stage_item],
        )
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
                status=enums.EncounterStatus.OPEN,
            ),
        ]

        class _EncounterResult:
            def scalars(self) -> SimpleNamespace:
                return SimpleNamespace(all=lambda: encounters)

        session = SimpleNamespace(
            execute=AsyncMock(return_value=_EncounterResult()),
            commit=AsyncMock(),
        )

        with (
            patch.object(
                swiss_rounds.stage_service,
                "get_stage",
                AsyncMock(return_value=stage),
            ),
            patch.object(
                swiss_rounds.stage_service,
                "_collect_item_team_ids",
                Mock(return_value=[1, 2, 3, 4]),
            ),
            patch.object(
                swiss_rounds.stage_service,
                "_generate_stage_skeleton",
                AsyncMock(),
            ) as generate_stage_skeleton,
            patch.object(
                swiss_rounds.stage_service,
                "_create_encounters_from_skeleton",
                AsyncMock(),
            ) as create_encounters,
            patch.object(
                swiss_rounds.standings_service,
                "recalculate_for_tournament",
                AsyncMock(),
            ) as recalculate_for_tournament,
        ):
            generated = await swiss_rounds._generate_next_round(session, event)

        self.assertEqual([], generated)
        generate_stage_skeleton.assert_not_awaited()
        create_encounters.assert_not_awaited()
        recalculate_for_tournament.assert_not_awaited()
        session.commit.assert_not_awaited()
