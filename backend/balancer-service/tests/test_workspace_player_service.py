from __future__ import annotations

import asyncio
import os
import sys
from pathlib import Path
from datetime import UTC, datetime
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

from sqlalchemy.exc import IntegrityError  # noqa: E402

from shared.core.errors import BaseAPIException as HTTPException  # noqa: E402
from src.services.workspace_player import WorkspacePlayerService  # noqa: E402


class _Savepoint:
    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, tb):
        return False


def _session() -> MagicMock:
    session = MagicMock()
    session.flush = AsyncMock()
    session.begin_nested = MagicMock(return_value=_Savepoint())
    return session


def _row(**fields) -> SimpleNamespace:
    return SimpleNamespace(**fields)


class WorkspacePlayerServiceTests(IsolatedAsyncioTestCase):
    if sys.platform == "win32":
        loop_factory = asyncio.SelectorEventLoop

    def setUp(self) -> None:
        self.players = MagicMock()
        self.ranks = MagicMock()
        self.players.get = AsyncMock()
        self.players.get_active_by_tag = AsyncMock()
        self.players.get_active_by_player_id = AsyncMock()
        self.players.create = AsyncMock()
        self.players.delete = AsyncMock()
        self.ranks.list_ranks = AsyncMock(return_value=[])
        self.ranks.create = AsyncMock(side_effect=lambda _s, row: row)
        self.ranks.delete = AsyncMock()
        self.service = WorkspacePlayerService(players=self.players, ranks=self.ranks)
        self.session = _session()

    async def test_upsert_empty_tag_fails(self) -> None:
        with self.assertRaises(HTTPException) as ctx:
            await self.service.upsert(self.session, workspace_id=1, battle_tag="   ")
        self.assertEqual(ctx.exception.status_code, 422)
        self.players.create.assert_not_called()

    async def test_upsert_hit_updates(self) -> None:
        existing = _row(id=1, workspace_id=1, battle_tag="old#1", display_name=None)
        self.players.get_active_by_tag.return_value = existing
        result = await self.service.upsert(
            self.session, workspace_id=1, battle_tag="Old # 1", display_name="Hero"
        )
        self.assertIs(result, existing)
        self.assertEqual(existing.battle_tag, "Old#1")
        self.assertEqual(existing.display_name, "Hero")
        self.session.flush.assert_awaited()
        self.players.create.assert_not_called()

    async def test_upsert_integrity_error_retries_to_existing(self) -> None:
        raced = _row(id=9, workspace_id=1, battle_tag="foo#1")
        self.players.get_active_by_tag.side_effect = [None, raced]
        self.players.create.side_effect = IntegrityError("INSERT", {}, Exception("dup"))
        result = await self.service.upsert(self.session, workspace_id=1, battle_tag="Foo#1")
        self.assertIs(result, raced)
        self.session.begin_nested.assert_called_once()
        self.assertEqual(self.players.get_active_by_tag.await_count, 2)

    async def test_link_sets_when_free(self) -> None:
        row = _row(id=1, workspace_id=1, player_id=None, workspace_member_id=None)
        self.players.get.return_value = row
        self.players.get_active_by_player_id.return_value = None
        result = await self.service.link(
            self.session, workspace_player_id=1, player_id=44, workspace_member_id=7
        )
        self.assertIs(result, row)
        self.assertEqual(row.player_id, 44)
        self.assertEqual(row.workspace_member_id, 7)
        self.players.delete.assert_not_called()

    async def test_link_merges_when_player_id_taken(self) -> None:
        donor = _row(id=1, workspace_id=1, player_id=None)
        survivor = _row(id=2, workspace_id=1, player_id=44, workspace_member_id=None)
        self.players.get.side_effect = lambda _session, pk: {1: donor, 2: survivor}[pk]
        self.players.get_active_by_player_id.return_value = survivor
        result = await self.service.link(
            self.session, workspace_player_id=1, player_id=44, workspace_member_id=7
        )
        self.assertIs(result, survivor)
        self.assertEqual(survivor.workspace_member_id, 7)
        self.players.delete.assert_awaited_once()
        self.assertIs(self.players.delete.await_args.args[1], donor)

    async def test_link_integrity_error_merges_into_existing(self) -> None:
        row = _row(id=1, workspace_id=1, player_id=None, workspace_member_id=None)
        survivor = _row(id=2, workspace_id=1, player_id=44, workspace_member_id=None)
        self.players.get.side_effect = lambda _session, pk: {1: row, 2: survivor}[pk]
        self.players.get_active_by_player_id.side_effect = [None, survivor]
        self.session.flush.side_effect = [IntegrityError("UPDATE", {}, Exception("dup")), None]
        result = await self.service.link(
            self.session, workspace_player_id=1, player_id=44, workspace_member_id=7
        )
        self.assertIs(result, survivor)
        self.assertEqual(survivor.workspace_member_id, 7)
        self.session.begin_nested.assert_called_once()
        self.players.delete.assert_awaited_once()
        self.assertIs(self.players.delete.await_args.args[1], row)

    async def test_merge_reassigns_and_deletes_ranks(self) -> None:
        older = datetime(2026, 1, 1, tzinfo=UTC)
        newer = datetime(2026, 2, 1, tzinfo=UTC)
        survivor = _row(id=2, workspace_id=1, player_id=44)
        donor = _row(id=1, workspace_id=1, player_id=None)
        s_tank = _row(id=10, role="tank", rank_value=1000, updated_at=older, workspace_player_id=2)
        d_tank = _row(id=11, role="tank", rank_value=2500, updated_at=newer, workspace_player_id=1)
        d_dps = _row(id=12, role="dps", rank_value=2000, updated_at=older, workspace_player_id=1)
        self.players.get.side_effect = lambda _session, pk: {1: donor, 2: survivor}[pk]
        self.ranks.list_ranks.side_effect = lambda _session, wpid: {2: [s_tank], 1: [d_tank, d_dps]}[wpid]
        result = await self.service.merge(self.session, survivor_id=2, donor_id=1)
        self.assertIs(result, survivor)
        self.ranks.delete.assert_awaited_once()
        self.assertIs(self.ranks.delete.await_args.args[1], s_tank)
        self.assertEqual(d_tank.workspace_player_id, 2)
        self.assertEqual(d_dps.workspace_player_id, 2)
        self.players.delete.assert_awaited_once()
        self.assertIs(self.players.delete.await_args.args[1], donor)

    async def test_set_ranks_creates_empty_cell(self) -> None:
        self.ranks.list_ranks.return_value = []
        result = await self.service.set_ranks(
            self.session, workspace_player_id=1, ranks={"tank": 2500}, only_empty=True
        )
        self.ranks.create.assert_awaited_once()
        self.assertEqual(result["tank"], 2500)

    async def test_set_ranks_only_empty_skips_existing(self) -> None:
        existing = _row(role="tank", rank_value=2000)
        self.ranks.list_ranks.return_value = [existing]
        result = await self.service.set_ranks(
            self.session, workspace_player_id=1, ranks={"tank": 3000}, only_empty=True
        )
        self.ranks.create.assert_not_called()
        self.assertEqual(existing.rank_value, 2000)
        self.assertEqual(result["tank"], 2000)

    async def test_set_ranks_overwrites_when_not_only_empty(self) -> None:
        existing = _row(role="tank", rank_value=2000)
        self.ranks.list_ranks.return_value = [existing]
        result = await self.service.set_ranks(
            self.session, workspace_player_id=1, ranks={"tank": 3000}, only_empty=False
        )
        self.assertEqual(existing.rank_value, 3000)
        self.assertEqual(result["tank"], 3000)
