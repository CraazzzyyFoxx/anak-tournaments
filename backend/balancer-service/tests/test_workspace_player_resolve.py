from __future__ import annotations

import asyncio
import os
import sys
from pathlib import Path
from types import SimpleNamespace
from unittest import IsolatedAsyncioTestCase
from unittest.mock import AsyncMock, MagicMock, patch

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

from shared.domain.workspace_player import ResolvedRank  # noqa: E402
from src.services.workspace_player import WorkspacePlayerService  # noqa: E402

_FETCH = "shared.services.workspace_player.fetch_latest_ow_ranks_by_account"


def _row(**fields) -> SimpleNamespace:
    return SimpleNamespace(**fields)


class WorkspacePlayerResolveTests(IsolatedAsyncioTestCase):
    if sys.platform == "win32":
        loop_factory = asyncio.SelectorEventLoop

    def setUp(self) -> None:
        self.players = MagicMock()
        self.ranks = MagicMock()
        self.host_ranks = MagicMock()
        self.ranks.list_ranks_for_players = AsyncMock(return_value=[])
        self.host_ranks.list_for_host_players = AsyncMock(return_value=[])
        self.service = WorkspacePlayerService(players=self.players, ranks=self.ranks, host_ranks=self.host_ranks)
        self.session = MagicMock()

    async def test_override_skips_ow(self) -> None:
        player = _row(id=1, player_id=10)
        with patch(_FETCH, new=AsyncMock()) as fetch:
            result = await self.service.resolve_ranks(
                self.session,
                players=[player],
                roles=["tank"],
                overrides={(1, "tank"): 1500},
            )
        fetch.assert_not_awaited()
        self.assertEqual(result[(1, "tank")], ResolvedRank(1500, "override"))

    async def test_canon_used_when_no_override(self) -> None:
        player = _row(id=1, player_id=10)
        self.ranks.list_ranks_for_players.return_value = [
            _row(workspace_player_id=1, role="tank", rank_value=2000),
        ]
        with patch(_FETCH, new=AsyncMock()) as fetch:
            result = await self.service.resolve_ranks(self.session, players=[player], roles=["tank"])
        fetch.assert_not_awaited()
        self.assertEqual(result[(1, "tank")], ResolvedRank(2000, "canon"))

    async def test_ow_used_once_for_batch(self) -> None:
        p1 = _row(id=1, player_id=10)
        p2 = _row(id=2, player_id=20)
        fetch = AsyncMock(
            return_value={
                10: {"A#1": {"tank": 2500}},
                20: {"B#2": {"tank": 1800}},
            }
        )
        with patch(_FETCH, new=fetch):
            result = await self.service.resolve_ranks(self.session, players=[p1, p2], roles=["tank"])
        fetch.assert_awaited_once()
        self.assertEqual(fetch.await_args.args[1], [10, 20])
        self.assertEqual(result[(1, "tank")], ResolvedRank(2500, "ow"))
        self.assertEqual(result[(2, "tank")], ResolvedRank(1800, "ow"))

    async def test_ghost_without_player_id_is_none(self) -> None:
        ghost = _row(id=3, player_id=None)
        with patch(_FETCH, new=AsyncMock()) as fetch:
            result = await self.service.resolve_ranks(self.session, players=[ghost], roles=["tank"])
        fetch.assert_not_awaited()
        self.assertEqual(result[(3, "tank")], ResolvedRank(None, "none"))

    async def test_missing_after_all_layers_is_none(self) -> None:
        player = _row(id=1, player_id=10)
        with patch(_FETCH, new=AsyncMock(return_value={})) as fetch:
            result = await self.service.resolve_ranks(self.session, players=[player], roles=["tank"])
        fetch.assert_awaited_once()
        self.assertEqual(result[(1, "tank")], ResolvedRank(None, "none"))

    async def test_host_wins_over_canon(self) -> None:
        player = _row(id=1, player_id=10)
        self.ranks.list_ranks_for_players.return_value = [
            _row(workspace_player_id=1, role="tank", rank_value=2000),
        ]
        self.host_ranks.list_for_host_players.return_value = [
            _row(workspace_player_id=1, role="tank", rank_value=3100),
        ]
        with patch(_FETCH, new=AsyncMock()) as fetch:
            result = await self.service.resolve_ranks(
                self.session, players=[player], roles=["tank"], host_user_id=99
            )
        fetch.assert_not_awaited()
        self.host_ranks.list_for_host_players.assert_awaited_once()
        self.assertEqual(self.host_ranks.list_for_host_players.await_args.args[1], 99)
        self.assertEqual(result[(1, "tank")], ResolvedRank(3100, "host"))

    async def test_override_wins_over_host(self) -> None:
        player = _row(id=1, player_id=10)
        self.host_ranks.list_for_host_players.return_value = [
            _row(workspace_player_id=1, role="tank", rank_value=3100),
        ]
        with patch(_FETCH, new=AsyncMock()) as fetch:
            result = await self.service.resolve_ranks(
                self.session,
                players=[player],
                roles=["tank"],
                overrides={(1, "tank"): 1500},
                host_user_id=99,
            )
        fetch.assert_not_awaited()
        self.assertEqual(result[(1, "tank")], ResolvedRank(1500, "override"))

    async def test_host_user_id_none_skips_host_query(self) -> None:
        player = _row(id=1, player_id=10)
        self.ranks.list_ranks_for_players.return_value = [
            _row(workspace_player_id=1, role="tank", rank_value=2000),
        ]
        with patch(_FETCH, new=AsyncMock()) as fetch:
            result = await self.service.resolve_ranks(self.session, players=[player], roles=["tank"])
        fetch.assert_not_awaited()
        self.host_ranks.list_for_host_players.assert_not_awaited()
        self.assertEqual(result[(1, "tank")], ResolvedRank(2000, "canon"))
