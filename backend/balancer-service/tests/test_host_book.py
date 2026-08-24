from __future__ import annotations

import asyncio
import os
import sys
from datetime import UTC, datetime
from pathlib import Path
from types import SimpleNamespace
from unittest import IsolatedAsyncioTestCase
from unittest.mock import AsyncMock, MagicMock

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

from shared.core.errors import BaseAPIException as HTTPException  # noqa: E402
from shared.services.host_book import HostBookService  # noqa: E402
from src.services.workspace_player import WorkspacePlayerService  # noqa: E402


class _Savepoint:
    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, tb):
        return False


def _session() -> MagicMock:
    session = MagicMock()
    session.begin_nested.return_value = _Savepoint()
    session.flush = AsyncMock()
    return session


def _row(**fields) -> SimpleNamespace:
    return SimpleNamespace(**fields)


class HostBookServiceTests(IsolatedAsyncioTestCase):
    if sys.platform == "win32":
        loop_factory = asyncio.SelectorEventLoop

    def setUp(self) -> None:
        self.players = MagicMock()
        self.memberships = MagicMock()
        self.book = MagicMock()
        self.players.get = AsyncMock(return_value=_row(id=7, workspace_id=1))
        self.memberships.get_by = AsyncMock(return_value=None)
        self.memberships.create = AsyncMock(side_effect=lambda _s, row: row)
        self.memberships.delete = AsyncMock()
        self.memberships.list_pool = AsyncMock(return_value=[])
        self.book.list_book = AsyncMock(return_value=[])
        self.book.create = AsyncMock(side_effect=lambda _s, row: row)
        self.book.delete = AsyncMock()
        self.service = HostBookService(players=self.players, memberships=self.memberships, book=self.book)
        self.session = _session()

    async def test_remove_keeps_ranks(self) -> None:
        membership = _row(id=3, workspace_id=1, host_user_id=9, workspace_player_id=7)
        rank = _row(role="tank", rank_value=2800)
        self.memberships.get_by.return_value = membership
        self.book.list_book.return_value = [rank]
        await self.service.remove(
            self.session, workspace_id=1, host_user_id=9, workspace_player_id=7, actor_user_id=9
        )
        self.memberships.delete.assert_awaited_once()
        self.assertIs(self.memberships.delete.await_args.args[1], membership)
        self.book.delete.assert_not_called()
        leftover = await self.service.get_book(self.session, workspace_id=1, host_user_id=9, workspace_player_id=7)
        self.assertEqual(leftover, {"tank": 2800})

    async def test_write_other_host_403(self) -> None:
        with self.assertRaises(HTTPException) as ctx:
            await self.service.add(
                self.session, workspace_id=1, host_user_id=9, workspace_player_id=7, actor_user_id=2
            )
        self.assertEqual(ctx.exception.status_code, 403)
        self.memberships.create.assert_not_called()

        with self.assertRaises(HTTPException) as ctx:
            await self.service.remove(
                self.session, workspace_id=1, host_user_id=9, workspace_player_id=7, actor_user_id=2
            )
        self.assertEqual(ctx.exception.status_code, 403)
        self.memberships.delete.assert_not_called()

        with self.assertRaises(HTTPException) as ctx:
            await self.service.set_ranks(
                self.session, workspace_id=1, host_user_id=9, workspace_player_id=7, ranks={"tank": 1}, actor_user_id=2
            )
        self.assertEqual(ctx.exception.status_code, 403)
        self.book.create.assert_not_called()

    async def test_read_other_host_in_same_workspace_ok(self) -> None:
        pool_row = _row(workspace_id=1, host_user_id=9, workspace_player_id=7)
        self.memberships.list_pool.return_value = [pool_row]
        self.book.list_book.return_value = [_row(role="dps", rank_value=1900)]
        pool = await self.service.list_pool(self.session, workspace_id=1, host_user_id=9)
        book = await self.service.get_book(self.session, workspace_id=1, host_user_id=9, workspace_player_id=7)
        self.assertEqual(pool, [pool_row])
        self.assertEqual(book, {"dps": 1900})


    async def test_cross_workspace_player_404(self) -> None:
        self.players.get.return_value = _row(id=7, workspace_id=2)
        with self.assertRaises(HTTPException) as ctx:
            await self.service.set_ranks(
                self.session, workspace_id=1, host_user_id=9, workspace_player_id=7, ranks={"tank": 1}, actor_user_id=9
            )
        self.assertEqual(ctx.exception.status_code, 404)
        self.book.create.assert_not_called()

        with self.assertRaises(HTTPException) as ctx:
            await self.service.get_book(self.session, workspace_id=1, host_user_id=9, workspace_player_id=7)
        self.assertEqual(ctx.exception.status_code, 404)
        self.book.list_book.assert_not_called()

class HostMergeTests(IsolatedAsyncioTestCase):
    if sys.platform == "win32":
        loop_factory = asyncio.SelectorEventLoop

    def setUp(self) -> None:
        self.players = MagicMock()
        self.ranks = MagicMock()
        self.host_players = MagicMock()
        self.host_ranks = MagicMock()
        self.players.get = AsyncMock()
        self.players.delete = AsyncMock()
        self.ranks.list_ranks = AsyncMock(return_value=[])
        self.ranks.delete = AsyncMock()
        self.host_players.list_for_player = AsyncMock(return_value=[])
        self.host_ranks.list_for_player = AsyncMock(return_value=[])
        self.host_ranks.delete = AsyncMock()
        self.service = WorkspacePlayerService(
            players=self.players,
            ranks=self.ranks,
            host_players=self.host_players,
            host_ranks=self.host_ranks,
        )
        self.session = _session()

    async def test_merge_moves_memberships(self) -> None:
        survivor = _row(id=2, workspace_id=1)
        donor = _row(id=1, workspace_id=1)
        keep = _row(id=20, host_user_id=8, workspace_player_id=2)
        move = _row(id=21, host_user_id=9, workspace_player_id=1)
        conflict = _row(id=22, host_user_id=8, workspace_player_id=1)
        self.players.get.side_effect = lambda _session, pk: {1: donor, 2: survivor}[pk]
        self.host_players.list_for_player.side_effect = lambda _session, wpid: {
            2: [keep],
            1: [move, conflict],
        }[wpid]
        result = await self.service.merge(self.session, survivor_id=2, donor_id=1)
        self.assertIs(result, survivor)
        self.assertEqual(move.workspace_player_id, 2)
        self.assertEqual(conflict.workspace_player_id, 1)
        self.players.delete.assert_awaited_once()
        self.assertIs(self.players.delete.await_args.args[1], donor)

    async def test_merge_host_ranks_latest_wins(self) -> None:
        older = datetime(2026, 1, 1, tzinfo=UTC)
        newer = datetime(2026, 2, 1, tzinfo=UTC)
        survivor = _row(id=2, workspace_id=1)
        donor = _row(id=1, workspace_id=1)
        s_tank = _row(id=30, host_user_id=9, role="tank", rank_value=1000, updated_at=older, workspace_player_id=2)
        d_tank = _row(id=31, host_user_id=9, role="tank", rank_value=2500, updated_at=newer, workspace_player_id=1)
        d_dps = _row(id=32, host_user_id=9, role="dps", rank_value=2000, updated_at=older, workspace_player_id=1)
        self.players.get.side_effect = lambda _session, pk: {1: donor, 2: survivor}[pk]
        self.host_ranks.list_for_player.side_effect = lambda _session, wpid: {
            2: [s_tank],
            1: [d_tank, d_dps],
        }[wpid]
        await self.service.merge(self.session, survivor_id=2, donor_id=1)
        self.host_ranks.delete.assert_awaited_once()
        self.assertIs(self.host_ranks.delete.await_args.args[1], s_tank)
        self.assertEqual(d_tank.workspace_player_id, 2)
        self.assertEqual(d_dps.workspace_player_id, 2)
