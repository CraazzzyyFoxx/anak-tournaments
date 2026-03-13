from __future__ import annotations

import os
import sys
from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace
from unittest import IsolatedAsyncioTestCase, TestCase


REPO_BACKEND_ROOT = Path(__file__).resolve().parents[2]
PARSER_SERVICE_ROOT = REPO_BACKEND_ROOT / "parser-service"

for candidate in (str(REPO_BACKEND_ROOT), str(PARSER_SERVICE_ROOT)):
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

from src.services.admin.balancer import (  # noqa: E402
    filter_ranked_role_entries,
    normalize_role_entries,
    parse_imported_player_nodes,
    serialize_player_for_export,
)


class NormalizeRoleEntriesTests(TestCase):
    def test_preserves_is_active_flag(self) -> None:
        entries = [
            {
                "role": "dps",
                "priority": 2,
                "division_number": None,
                "rank_value": 2450,
                "is_active": False,
            },
            {
                "role": "tank",
                "priority": 1,
                "division_number": None,
                "rank_value": 2550,
            },
        ]

        normalized = normalize_role_entries(entries)
        normalized_by_role = {entry["role"]: entry for entry in normalized}

        self.assertEqual(True, normalized_by_role["tank"]["is_active"])
        self.assertEqual(False, normalized_by_role["dps"]["is_active"])

    def test_filter_ranked_role_entries_skips_inactive_roles(self) -> None:
        entries = [
            {
                "role": "tank",
                "priority": 1,
                "division_number": None,
                "rank_value": 2550,
                "is_active": False,
            },
            {
                "role": "support",
                "priority": 2,
                "division_number": None,
                "rank_value": 2100,
                "is_active": True,
            },
        ]

        filtered = filter_ranked_role_entries(entries)

        self.assertEqual(["support"], [entry["role"] for entry in filtered])


class SerializePlayerForExportTests(TestCase):
    def test_uses_role_activity_for_exported_is_active(self) -> None:
        player = SimpleNamespace(
            battle_tag="Player#1234",
            is_flex=False,
            created_at=datetime(2026, 3, 14, tzinfo=timezone.utc),
            role_entries_json=[
                {
                    "role": "tank",
                    "priority": 1,
                    "division_number": 1,
                    "rank_value": 2550,
                    "is_active": True,
                },
                {
                    "role": "support",
                    "priority": 2,
                    "division_number": 3,
                    "rank_value": 2150,
                    "is_active": False,
                },
            ],
        )

        exported = serialize_player_for_export(player, "export-uuid")

        self.assertTrue(exported["stats"]["classes"]["tank"]["isActive"])
        self.assertFalse(exported["stats"]["classes"]["support"]["isActive"])
        self.assertEqual(0, exported["stats"]["classes"]["support"]["rank"])


class ParseImportedPlayerNodesTests(IsolatedAsyncioTestCase):
    async def test_meta_role_entries_respect_is_active_flag(self) -> None:
        payload = {
            "format": "xv-1",
            "players": {
                "player-1": {
                    "identity": {"name": "Player#1234"},
                    "meta": {
                        "roleEntries": [
                            {
                                "role": "tank",
                                "priority": 1,
                                "division_number": 1,
                                "rank_value": 2550,
                                "isActive": False,
                            },
                            {
                                "role": "support",
                                "priority": 2,
                                "division_number": 3,
                                "rank_value": 2150,
                                "isActive": True,
                            },
                        ]
                    },
                }
            },
        }

        parsed_players, skipped = parse_imported_player_nodes(payload)

        self.assertEqual([], skipped)
        self.assertEqual(["support"], [entry["role"] for entry in parsed_players[0]["role_entries_json"]])
