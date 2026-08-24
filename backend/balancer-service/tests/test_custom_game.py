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

from shared.core.errors import BaseAPIException as HTTPException  # noqa: E402
from shared.domain.workspace_player import ResolvedRank  # noqa: E402
from src.services.custom_game import CustomGameService  # noqa: E402


def _session() -> MagicMock:
    session = MagicMock()
    session.flush = AsyncMock()
    return session


def _row(**fields) -> SimpleNamespace:
    return SimpleNamespace(**fields)


def _player(pid: int) -> SimpleNamespace:
    return _row(id=pid, workspace_id=1, display_name=f"P{pid}", battle_tag=f"P{pid}#1")


def _ranks(*player_ids: int) -> dict[tuple[int, str], ResolvedRank]:
    out: dict[tuple[int, str], ResolvedRank] = {}
    for pid in player_ids:
        out[(pid, "tank")] = ResolvedRank(2500, "canon")
        out[(pid, "dps")] = ResolvedRank(2400, "canon")
        out[(pid, "support")] = ResolvedRank(2300, "canon")
    return out


class CustomGameServiceTests(IsolatedAsyncioTestCase):
    if sys.platform == "win32":
        loop_factory = asyncio.SelectorEventLoop

    def setUp(self) -> None:
        self.games = MagicMock()
        self.roster = MagicMock()
        self.players = MagicMock()
        self.host_players = MagicMock()
        self.ranks = MagicMock()
        self.run_balance = AsyncMock(return_value={"variants": []})
        self.games.create = AsyncMock(side_effect=self._assign_id)
        self.games.get = AsyncMock()
        self.games.list_for_workspace = AsyncMock(return_value=[])
        self.roster.create_many = AsyncMock(side_effect=lambda _s, rows: rows)
        self.roster.list_for_game = AsyncMock(return_value=[])
        self.roster.delete_for_game = AsyncMock()
        self.roster.get_by = AsyncMock(return_value=None)
        self.players.bulk_get = AsyncMock(return_value=[])
        self.host_players.list_pool = AsyncMock(return_value=[])
        self.ranks.resolve_ranks = AsyncMock(return_value={})
        self.service = CustomGameService(
            games=self.games,
            roster=self.roster,
            players=self.players,
            host_players=self.host_players,
            ranks=self.ranks,
            run_balance=self.run_balance,
        )
        self.session = _session()

    @staticmethod
    async def _assign_id(_session, row):
        if getattr(row, "id", None) is None:
            row.id = 11
        return row

    async def test_create_roster_from_workspace_player_ids(self) -> None:
        self.players.bulk_get.return_value = [_player(7), _player(8)]
        game = await self.service.create(
            self.session,
            workspace_id=1,
            host_user_id=9,
            name="Scrim",
            actor_user_id=9,
            player_ids=[7, 8],
        )
        self.assertEqual(game.status, "draft")
        self.assertEqual(game.name, "Scrim")
        self.assertEqual(game.workspace_id, 1)
        self.assertEqual(game.host_user_id, 9)
        self.host_players.list_pool.assert_not_called()
        self.games.create.assert_awaited_once()
        rows = self.roster.create_many.await_args.args[1]
        self.assertEqual([row.workspace_player_id for row in rows], [7, 8])
        self.assertEqual([row.sort_order for row in rows], [0, 1])

    async def test_balance_calls_run_balance_and_stores_result(self) -> None:
        game = _row(
            id=11,
            workspace_id=1,
            host_user_id=9,
            name="Scrim",
            status="draft",
            config_json=None,
            result_json=None,
            outcome_json=None,
        )
        roster = [
            _row(id=1, custom_game_id=11, workspace_player_id=7, rank_value=None, team_index=None, sort_order=0),
            _row(id=2, custom_game_id=11, workspace_player_id=8, rank_value=None, team_index=None, sort_order=1),
        ]
        payload = {
            "variants": [
                {
                    "teams": [
                        {"roster": {"tank": [{"uuid": "7"}]}},
                        {"roster": {"tank": [{"uuid": "8"}]}},
                    ]
                }
            ]
        }
        self.games.get.return_value = game
        self.roster.list_for_game.return_value = roster
        self.players.bulk_get.return_value = [_player(7), _player(8)]
        self.ranks.resolve_ranks.return_value = _ranks(7, 8)
        self.run_balance.return_value = payload

        with patch("shared.models.BalancerBalance") as balance_cls:
            out = await self.service.balance(
                self.session, workspace_id=1, custom_game_id=11, actor_user_id=9
            )
            balance_cls.assert_not_called()

        self.run_balance.assert_awaited_once()
        player_data, config_overrides, _progress, role_mask = self.run_balance.await_args.args
        self.assertIn("7", player_data["players"])
        self.assertIn("8", player_data["players"])
        self.assertIsNone(config_overrides)
        self.assertEqual(role_mask["tank"], 1)
        self.assertEqual(out.status, "balanced")
        self.assertIs(out.result_json, payload)
        self.assertNotIn("tournament_id", payload)
        self.assertEqual(roster[0].team_index, 0)
        self.assertEqual(roster[1].team_index, 1)

    async def test_completed_balance_409(self) -> None:
        self.games.get.return_value = _row(
            id=11, workspace_id=1, host_user_id=9, name="Scrim", status="completed"
        )
        with self.assertRaises(HTTPException) as ctx:
            await self.service.balance(self.session, workspace_id=1, custom_game_id=11, actor_user_id=9)
        self.assertEqual(ctx.exception.status_code, 409)
        self.run_balance.assert_not_called()
        self.ranks.resolve_ranks.assert_not_called()

    async def test_set_rank_override_used_in_resolve(self) -> None:
        game = _row(
            id=11,
            workspace_id=1,
            host_user_id=9,
            name="Scrim",
            status="draft",
            config_json=None,
            result_json=None,
            outcome_json=None,
        )
        row = _row(id=1, custom_game_id=11, workspace_player_id=7, rank_value=None, team_index=None, sort_order=0)
        self.games.get.return_value = game
        self.roster.get_by.return_value = row
        await self.service.set_rank(
            self.session,
            workspace_id=1,
            custom_game_id=11,
            workspace_player_id=7,
            rank_value=1500,
            actor_user_id=9,
        )
        self.assertEqual(row.rank_value, 1500)

        self.roster.list_for_game.return_value = [row]
        self.players.bulk_get.return_value = [_player(7)]
        self.ranks.resolve_ranks.return_value = {
            (7, "tank"): ResolvedRank(1500, "override"),
            (7, "dps"): ResolvedRank(1500, "override"),
            (7, "support"): ResolvedRank(1500, "override"),
        }
        await self.service.balance(self.session, workspace_id=1, custom_game_id=11, actor_user_id=9)
        kwargs = self.ranks.resolve_ranks.await_args.kwargs
        self.assertEqual(kwargs["host_user_id"], 9)
        self.assertEqual(kwargs["overrides"][(7, "tank")], 1500)
        self.assertEqual(kwargs["overrides"][(7, "dps")], 1500)
        self.assertEqual(kwargs["overrides"][(7, "support")], 1500)

    async def test_record_outcome_terminal_409(self) -> None:
        for status in ("completed", "cancelled"):
            with self.subTest(status=status):
                self.games.get.return_value = _row(
                    id=11, workspace_id=1, host_user_id=9, name="Scrim", status=status
                )
                with self.assertRaises(HTTPException) as ctx:
                    await self.service.record_outcome(
                        self.session,
                        workspace_id=1,
                        custom_game_id=11,
                        outcome_json={"winner": 1},
                        actor_user_id=9,
                    )
                self.assertEqual(ctx.exception.status_code, 409)
                self.session.flush.assert_not_called()
                self.session.flush.reset_mock()
