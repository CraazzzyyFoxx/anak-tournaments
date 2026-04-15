"""Regression tests for admin balancer serializers that must not lazy-load ORM relations."""

from __future__ import annotations

import os
import sys
from datetime import UTC, datetime
from pathlib import Path
from unittest import TestCase

REPO_BACKEND_ROOT = Path(__file__).resolve().parents[2]
BALANCER_SERVICE_ROOT = REPO_BACKEND_ROOT / "balancer-service"

for candidate in (str(REPO_BACKEND_ROOT), str(BALANCER_SERVICE_ROOT)):
    if candidate not in sys.path:
        sys.path.insert(0, candidate)

os.environ.setdefault("PROJECT_URL", "http://localhost")
os.environ.setdefault("REDIS_URL", "redis://localhost:6379/0")
os.environ.setdefault("POSTGRES_USER", "postgres")
os.environ.setdefault("POSTGRES_PASSWORD", "postgres")
os.environ.setdefault("POSTGRES_DB", "postgres")
os.environ.setdefault("POSTGRES_HOST", "localhost")
os.environ.setdefault("POSTGRES_PORT", "5432")
os.environ.setdefault("CHALLONGE_USERNAME", "test")
os.environ.setdefault("CHALLONGE_API_KEY", "test")
os.environ.setdefault("S3_ACCESS_KEY", "test")
os.environ.setdefault("S3_SECRET_KEY", "test")
os.environ.setdefault("S3_ENDPOINT_URL", "http://localhost")
os.environ.setdefault("S3_BUCKET_NAME", "test")
os.environ["DEBUG"] = "false"

from src import models  # noqa: E402
from src.routes.admin import balancer as balancer_route  # noqa: E402


class AdminBalancerSerializerTests(TestCase):
    def test_serialize_player_uses_json_payload_when_role_entries_not_loaded(self) -> None:
        player = models.BalancerPlayer(
            id=10,
            tournament_id=64,
            application_id=100,
            battle_tag="Player#1234",
            battle_tag_normalized="player#1234",
            user_id=5,
            role_entries_json=[
                {
                    "role": "tank",
                    "subtype": None,
                    "priority": 0,
                    "division_number": 3,
                    "rank_value": 2500,
                    "is_active": True,
                }
            ],
            is_flex=False,
            is_in_pool=True,
            admin_notes="seeded",
        )

        payload = balancer_route._serialize_player(player)

        self.assertEqual(len(payload.role_entries_json), 1)
        self.assertEqual(payload.role_entries_json[0].role, "tank")
        self.assertEqual(payload.role_entries_json[0].rank_value, 2500)

    def test_serialize_player_prefers_loaded_role_entries(self) -> None:
        player = models.BalancerPlayer(
            id=10,
            tournament_id=64,
            application_id=100,
            battle_tag="Player#1234",
            battle_tag_normalized="player#1234",
            user_id=5,
            role_entries_json=[],
            is_flex=False,
            is_in_pool=True,
            admin_notes=None,
        )
        player.role_entries = [
            models.BalancerPlayerRoleEntry(
                role="support",
                subtype="main_heal",
                priority=1,
                division_number=2,
                rank_value=3000,
                is_active=True,
            ),
            models.BalancerPlayerRoleEntry(
                role="tank",
                subtype=None,
                priority=0,
                division_number=3,
                rank_value=2500,
                is_active=True,
            ),
        ]

        payload = balancer_route._serialize_player(player)

        self.assertEqual([entry.role for entry in payload.role_entries_json], ["tank", "support"])
        self.assertEqual(payload.role_entries_json[1].subtype, "main_heal")

    def test_serialize_application_skips_unloaded_player_relationship(self) -> None:
        application = models.BalancerApplication(
            id=7,
            tournament_id=64,
            tournament_sheet_id=8,
            battle_tag="Applicant#1234",
            battle_tag_normalized="applicant#1234",
            smurf_tags_json=["Smurf#1111"],
            twitch_nick="streamer",
            discord_nick="discord",
            stream_pov=True,
            last_tournament_text="winter cup",
            primary_role="tank",
            additional_roles_json=["support"],
            notes="note",
            synced_at=datetime.now(UTC),
            is_active=True,
        )

        payload = balancer_route._serialize_application(application)

        self.assertIsNone(payload.player)
        self.assertEqual(payload.battle_tag, "Applicant#1234")
        self.assertEqual(payload.additional_roles_json, ["support"])
