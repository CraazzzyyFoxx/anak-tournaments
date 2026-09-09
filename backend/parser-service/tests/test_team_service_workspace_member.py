"""P5.3: parser-service's ``services.team.service`` Player-creation sites
(``create_player`` async + ``create_player_sync``) must populate
``workspace_member_id`` (``Player.user_id`` was dropped in the contract step,
iwrefac07) so workspace-scoped analytics readers that INNER-JOIN on it don't
silently drop newly created roster rows (e.g. log-import substitution creation).
"""

from __future__ import annotations

import importlib
import sys
from pathlib import Path
from types import SimpleNamespace
from unittest import IsolatedAsyncioTestCase
from unittest.mock import AsyncMock, Mock, patch

backend_root = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(backend_root))
sys.path.insert(0, str(backend_root / "parser-service"))


team_service = importlib.import_module("src.services.team.service")
enums = importlib.import_module("src.core.enums")


class TeamServiceWorkspaceMemberTests(IsolatedAsyncioTestCase):
    async def test_resolve_workspace_member_id_delegates_to_the_shared_helper(self) -> None:
        session = SimpleNamespace()

        with patch.object(
            team_service,
            "resolve_workspace_member_id",
            AsyncMock(return_value=777),
        ) as resolve:
            member_id = await team_service._resolve_workspace_member_id(session, tournament_id=88, player_id=7)

        self.assertEqual(777, member_id)
        resolve.assert_awaited_once_with(session, tournament_id=88, player_id=7)

    async def test_resolve_workspace_member_id_raises_when_tournament_missing(self) -> None:
        """The shared helper answers ``None`` for a tournament it cannot resolve
        a workspace for; this service's own not-found error is what wraps it."""
        session = SimpleNamespace()
        with patch.object(
            team_service,
            "resolve_workspace_member_id",
            AsyncMock(return_value=None),
        ):
            with self.assertRaises(ValueError):
                await team_service._resolve_workspace_member_id(session, tournament_id=404, player_id=7)

    async def test_create_player_sets_workspace_member_id(self) -> None:
        session = SimpleNamespace(add=Mock(), flush=AsyncMock(), commit=AsyncMock())
        user = SimpleNamespace(id=42)
        tournament = SimpleNamespace(id=88)
        team = SimpleNamespace(id=3)

        with patch.object(
            team_service,
            "_resolve_workspace_member_id",
            AsyncMock(return_value=999),
        ) as resolve_member:
            player = await team_service.create_player(
                session,
                name="Sub Player",
                rank=3000,
                role=enums.HeroClass.tank,
                user=user,
                tournament=tournament,
                team=team,
                is_substitution=True,
                related_player_id=10,
            )

        resolve_member.assert_awaited_once_with(session, tournament_id=88, player_id=42)
        self.assertFalse(hasattr(player, "user_id"))
        self.assertEqual(999, player.workspace_member_id)
        session.add.assert_called_once_with(player)
        session.commit.assert_awaited_once()
