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
from shared.domain.member_rank import ResolvedRank  # noqa: E402
from shared.services.member_rank import MIX_ORDER  # noqa: E402
from shared.services.workspace_roster import RosterMember  # noqa: E402
from src.services.custom_game import CustomGameService  # noqa: E402


def _session() -> MagicMock:
    session = MagicMock()
    session.flush = AsyncMock()
    return session


def _row(**fields) -> SimpleNamespace:
    return SimpleNamespace(**fields)


def _roster_row(row_id: int, member_id: int, sort_order: int, **overrides) -> SimpleNamespace:
    fields = {
        "id": row_id,
        "custom_game_id": 11,
        "workspace_member_id": member_id,
        "team_index": None,
        "sort_order": sort_order,
        "is_active": True,
        "roles_json": None,
    }
    fields.update(overrides)
    return _row(**fields)


def _game(**overrides) -> SimpleNamespace:
    fields = {
        "id": 11,
        "workspace_id": 1,
        "host_user_id": 9,
        "name": "Scrim",
        "status": "draft",
        "config_json": None,
        "result_json": None,
        "outcome_json": None,
    }
    fields.update(overrides)
    return _row(**fields)


def _members(*member_ids: int) -> dict[int, RosterMember]:
    """The roster rows ``workspace_roster.list_roster`` would return."""
    return {
        member_id: RosterMember(
            member_id=member_id,
            player_id=member_id * 10,
            battle_tag=f"P{member_id}#1",
            display_name=f"P{member_id}",
        )
        for member_id in member_ids
    }


def _ranks(*member_ids: int) -> dict[tuple[int, str], ResolvedRank]:
    out: dict[tuple[int, str], ResolvedRank] = {}
    for member_id in member_ids:
        out[(member_id, "tank")] = ResolvedRank(2500, "workspace")
        out[(member_id, "dps")] = ResolvedRank(2400, "workspace")
        out[(member_id, "support")] = ResolvedRank(2300, "workspace")
    return out


class CustomGameServiceTests(IsolatedAsyncioTestCase):
    if sys.platform == "win32":
        loop_factory = asyncio.SelectorEventLoop

    def setUp(self) -> None:
        self.games = MagicMock()
        self.roster = MagicMock()
        self.ranks = MagicMock()
        self.run_balance = AsyncMock(return_value={"variants": []})
        self.games.create = AsyncMock(side_effect=self._assign_id)
        self.games.get = AsyncMock()
        self.games.list_for_workspace = AsyncMock(return_value=[])
        self.roster.create_many = AsyncMock(side_effect=lambda _s, rows: rows)
        self.roster.list_for_game = AsyncMock(return_value=[])
        self.roster.delete_for_game = AsyncMock()
        self.roster.get_by = AsyncMock(return_value=None)
        self.roster.delete = AsyncMock()
        # Every requested member exists in this workspace unless a test says otherwise.
        self.load_roster = AsyncMock(
            side_effect=lambda _s, *, workspace_id, member_ids: _members(*member_ids)
        )
        self.ranks.resolve = AsyncMock(return_value={})
        self.ranks.set_ranks = AsyncMock(return_value={})
        self.grid = object()
        self._grid_patch = patch(
            "src.services.custom_game.get_effective_division_grid",
            new=AsyncMock(return_value=self.grid),
        )
        self._grid_patch.start()
        self.addCleanup(self._grid_patch.stop)
        # No workspace-level roster default unless a test says otherwise --
        # `roster_shape`/`balance` then fall back to the built-in Overwatch 5v5
        # shape, matching every existing assertion below.
        self.workspace_roster_slots = AsyncMock(return_value=None)
        self._workspace_slots_patch = patch(
            "src.services.custom_game.get_workspace_roster_slots",
            new=self.workspace_roster_slots,
        )
        self._workspace_slots_patch.start()
        self.addCleanup(self._workspace_slots_patch.stop)
        self.service = CustomGameService(
            games=self.games,
            roster=self.roster,
            ranks=self.ranks,
            load_roster=self.load_roster,
            run_balance=self.run_balance,
        )
        self.session = _session()

    @staticmethod
    async def _assign_id(_session, row):
        if getattr(row, "id", None) is None:
            row.id = 11
        return row

    async def test_create_roster_from_member_ids(self) -> None:
        game = await self.service.create(
            self.session,
            workspace_id=1,
            host_user_id=9,
            name="Scrim",
            actor_user_id=9,
            member_ids=[7, 8],
        )
        self.assertEqual(game.status, "draft")
        self.assertEqual(game.name, "Scrim")
        self.assertEqual(game.workspace_id, 1)
        self.assertEqual(game.host_user_id, 9)
        self.games.create.assert_awaited_once()
        rows = self.roster.create_many.await_args.args[1]
        self.assertEqual([row.workspace_member_id for row in rows], [7, 8])
        self.assertEqual([row.sort_order for row in rows], [0, 1])

    async def test_create_without_members_is_an_empty_mix(self) -> None:
        await self.service.create(
            self.session, workspace_id=1, host_user_id=9, name="Scrim", actor_user_id=9
        )
        self.roster.create_many.assert_not_called()

    async def test_member_of_another_workspace_404(self) -> None:
        self.load_roster.side_effect = None
        self.load_roster.return_value = _members(7)
        with self.assertRaises(HTTPException) as ctx:
            await self.service.create(
                self.session,
                workspace_id=1,
                host_user_id=9,
                name="Scrim",
                actor_user_id=9,
                member_ids=[7, 8],
            )
        self.assertEqual(ctx.exception.status_code, 404)
        self.games.create.assert_not_called()

    async def test_balance_calls_run_balance_and_stores_result(self) -> None:
        game = _game()
        roster = [_roster_row(1, 7, 0), _roster_row(2, 8, 1)]
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
        self.ranks.resolve.return_value = _ranks(7, 8)
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

    async def test_balance_resolves_with_mix_order_and_host_as_author(self) -> None:
        self.games.get.return_value = _game()
        self.roster.list_for_game.return_value = [_roster_row(1, 7, 0)]
        self.ranks.resolve.return_value = _ranks(7)
        self.run_balance.return_value = {"teams": []}

        await self.service.balance(self.session, workspace_id=1, custom_game_id=11, actor_user_id=9)

        kwargs = self.ranks.resolve.await_args.kwargs
        self.assertEqual(kwargs["workspace_id"], 1)
        self.assertEqual(kwargs["order"], MIX_ORDER)
        self.assertEqual(kwargs["author_user_id"], 9)
        self.assertIs(kwargs["grid"], self.grid)
        # The resolver keys off member ids and needs the player behind each one
        # to reach an Overwatch snapshot.
        self.assertEqual(kwargs["members"], {7: 70})

    async def test_balance_names_players_from_the_roster(self) -> None:
        self.games.get.return_value = _game()
        self.roster.list_for_game.return_value = [_roster_row(1, 7, 0), _roster_row(2, 8, 1)]
        self.load_roster.side_effect = None
        self.load_roster.return_value = {
            7: RosterMember(member_id=7, player_id=70, battle_tag="Ana#1", display_name=None),
            8: RosterMember(member_id=8, player_id=80, battle_tag=None, display_name=None),
        }
        self.ranks.resolve.return_value = _ranks(7, 8)
        self.run_balance.return_value = {"teams": []}

        await self.service.balance(self.session, workspace_id=1, custom_game_id=11, actor_user_id=9)

        players = self.run_balance.await_args.args[0]["players"]
        self.assertEqual(players["7"]["identity"]["name"], "Ana#1")
        self.assertEqual(players["8"]["identity"]["name"], "player-8")

    async def test_completed_balance_409(self) -> None:
        self.games.get.return_value = _game(status="completed")
        with self.assertRaises(HTTPException) as ctx:
            await self.service.balance(self.session, workspace_id=1, custom_game_id=11, actor_user_id=9)
        self.assertEqual(ctx.exception.status_code, 409)
        self.run_balance.assert_not_called()
        self.ranks.resolve.assert_not_called()

    async def test_update_player_rejects_rank_value(self) -> None:
        """The per-game pin is gone: a correction belongs in the host's own book."""
        self.games.get.return_value = _game()
        with self.assertRaises(HTTPException) as ctx:
            await self.service.update_player(
                self.session,
                workspace_id=1,
                custom_game_id=11,
                workspace_member_id=7,
                patch={"rank_value": 1500},
                actor_user_id=9,
            )
        self.assertEqual(ctx.exception.status_code, 422)

    async def test_update_player_rejects_unknown_field(self) -> None:
        self.games.get.return_value = _game()
        with self.assertRaises(HTTPException) as ctx:
            await self.service.update_player(
                self.session,
                workspace_id=1,
                custom_game_id=11,
                workspace_member_id=7,
                patch={"team_index": 1},
                actor_user_id=9,
            )
        self.assertEqual(ctx.exception.status_code, 422)

    async def test_update_player_rejects_unknown_role(self) -> None:
        self.games.get.return_value = _game()
        self.roster.list_for_game.return_value = [_roster_row(1, 7, 0)]
        with self.assertRaises(HTTPException) as ctx:
            await self.service.update_player(
                self.session,
                workspace_id=1,
                custom_game_id=11,
                workspace_member_id=7,
                patch={"roles": ["tank", "healer"]},
                actor_user_id=9,
            )
        self.assertEqual(ctx.exception.status_code, 422)

    async def test_update_player_keeps_stored_balance(self) -> None:
        """A lineup edit must not blow away the last balance -- only pressing
        Balance teams again should replace it."""
        game = _game(status="balanced", result_json={"variants": []})
        row = _roster_row(1, 7, 0, team_index=0)
        self.games.get.return_value = game
        self.roster.list_for_game.return_value = [row]
        await self.service.update_player(
            self.session,
            workspace_id=1,
            custom_game_id=11,
            workspace_member_id=7,
            patch={"is_active": False},
            actor_user_id=9,
        )
        self.assertFalse(row.is_active)
        self.assertEqual(game.status, "balanced")
        self.assertEqual(game.result_json, {"variants": []})
        self.assertEqual(row.team_index, 0)

    async def test_balance_skips_benched_rows(self) -> None:
        game = _game()
        roster = [_roster_row(1, 7, 0), _roster_row(2, 8, 1, is_active=False)]
        self.games.get.return_value = game
        self.roster.list_for_game.return_value = roster
        self.ranks.resolve.return_value = _ranks(7)
        self.run_balance.return_value = {"teams": [{"roster": {"tank": [{"uuid": "7"}]}}]}

        await self.service.balance(self.session, workspace_id=1, custom_game_id=11, actor_user_id=9)

        player_data = self.run_balance.await_args.args[0]
        self.assertEqual(list(player_data["players"]), ["7"])
        # A benched row costs nothing to resolve, so it is not even looked up.
        self.assertEqual(self.ranks.resolve.await_args.kwargs["members"], {7: 70})
        self.assertEqual(roster[0].team_index, 0)
        self.assertIsNone(roster[1].team_index)

    async def test_balance_all_benched_422(self) -> None:
        self.games.get.return_value = _game()
        self.roster.list_for_game.return_value = [_roster_row(1, 7, 0, is_active=False)]
        with self.assertRaises(HTTPException) as ctx:
            await self.service.balance(self.session, workspace_id=1, custom_game_id=11, actor_user_id=9)
        self.assertEqual(ctx.exception.status_code, 422)
        self.assertEqual(ctx.exception.detail, "empty_lineup")
        self.run_balance.assert_not_called()

    async def test_balance_solver_value_error_is_422_not_internal(self) -> None:
        """The solver raises plain ``ValueError`` for diagnosable input problems
        (e.g. an 11th player breaks the 5-per-team default mask). Left uncaught
        it reached the generic RPC handler and was reported as an opaque
        "internal error" instead of the actual, actionable reason."""
        self.games.get.return_value = _game()
        self.roster.list_for_game.return_value = [_roster_row(1, 7, 0)]
        self.ranks.resolve.return_value = _ranks(7)
        self.run_balance.side_effect = ValueError(
            "Player count must be divisible by team size. Got 11 players, team size is 5"
        )

        with self.assertRaises(HTTPException) as ctx:
            await self.service.balance(self.session, workspace_id=1, custom_game_id=11, actor_user_id=9)
        self.assertEqual(ctx.exception.status_code, 422)
        self.assertIn("divisible by team size", ctx.exception.detail)

    async def test_balance_unranked_player_422(self) -> None:
        self.games.get.return_value = _game()
        self.roster.list_for_game.return_value = [_roster_row(1, 7, 0)]
        self.ranks.resolve.return_value = {
            (7, "tank"): ResolvedRank(None, "none"),
            (7, "dps"): ResolvedRank(None, "none"),
            (7, "support"): ResolvedRank(None, "none"),
        }
        with self.assertRaises(HTTPException) as ctx:
            await self.service.balance(self.session, workspace_id=1, custom_game_id=11, actor_user_id=9)
        self.assertEqual(ctx.exception.status_code, 422)
        self.assertEqual(ctx.exception.detail, "missing_ranked_role")
        self.run_balance.assert_not_called()

    async def test_balance_uses_role_order_as_priority(self) -> None:
        self.games.get.return_value = _game()
        self.roster.list_for_game.return_value = [_roster_row(1, 7, 0, roles_json=["support", "dps"])]
        self.ranks.resolve.return_value = _ranks(7)
        self.run_balance.return_value = {"teams": []}

        await self.service.balance(self.session, workspace_id=1, custom_game_id=11, actor_user_id=9)

        classes = self.run_balance.await_args.args[0]["players"]["7"]["stats"]["classes"]
        self.assertEqual(classes["support"]["priority"], 1)
        self.assertEqual(classes["dps"]["priority"], 2)
        self.assertNotIn("tank", classes)

    async def test_update_roster_keeps_surviving_row_state(self) -> None:
        game = _game()
        keep = _roster_row(1, 7, 0, is_active=False, roles_json=["dps"])
        drop = _roster_row(2, 8, 1)
        self.games.get.return_value = game
        self.roster.list_for_game.return_value = [keep, drop]

        await self.service.update_roster(
            self.session, workspace_id=1, custom_game_id=11, member_ids=[9, 7], actor_user_id=9
        )

        self.roster.delete.assert_awaited_once_with(self.session, drop)
        created = self.roster.create_many.await_args.args[1]
        self.assertEqual([row.workspace_member_id for row in created], [9])
        self.assertFalse(keep.is_active)
        self.assertEqual(keep.roles_json, ["dps"])
        self.assertEqual(keep.sort_order, 1)

    async def test_update_roster_keeps_stored_balance(self) -> None:
        """Adding or dropping a player must not blow away the last balance --
        only pressing Balance teams again should replace it."""
        game = _game(status="balanced", result_json={"variants": []})
        keep = _roster_row(1, 7, 0, team_index=0)
        self.games.get.return_value = game
        self.roster.list_for_game.return_value = [keep]

        await self.service.update_roster(
            self.session, workspace_id=1, custom_game_id=11, member_ids=[7, 9], actor_user_id=9
        )

        self.assertEqual(game.status, "balanced")
        self.assertEqual(game.result_json, {"variants": []})
        self.assertEqual(keep.team_index, 0)

    async def test_adding_players_materialises_the_hosts_own_ranks(self) -> None:
        """Joining a mix copies the effective rank into the host's book.

        Without this the number a lineup shows belongs to no layer the host can
        edit: the sheet writes the author layer, so a correction reads as a
        per-game edit while silently rewriting the host's book for every mix,
        and Clear has nothing to clear.
        """
        self.ranks.resolve.return_value = _ranks(7, 8)

        await self.service.create(
            self.session,
            workspace_id=1,
            host_user_id=9,
            name="Scrim",
            actor_user_id=9,
            member_ids=[7, 8],
        )

        seeded = {
            call.kwargs["workspace_member_id"]: call.kwargs
            for call in self.ranks.set_ranks.await_args_list
        }
        self.assertEqual(sorted(seeded), [7, 8])
        self.assertEqual(seeded[7]["author_user_id"], 9)
        self.assertEqual(seeded[7]["workspace_id"], 1)
        self.assertEqual(seeded[7]["ranks"], {"tank": 2500, "dps": 2400, "support": 2300})
        kwargs = self.ranks.resolve.await_args.kwargs
        self.assertEqual(kwargs["order"], MIX_ORDER)
        self.assertEqual(kwargs["author_user_id"], 9)
        self.assertIs(kwargs["grid"], self.grid)

    async def test_seeding_leaves_a_rank_the_host_already_owns_alone(self) -> None:
        """Re-adding somebody must not undo a correction the host already made."""
        self.ranks.resolve.return_value = {
            (7, "tank"): ResolvedRank(3000, "author"),
            (7, "dps"): ResolvedRank(2400, "workspace"),
            (7, "support"): ResolvedRank(None, "none"),
        }

        await self.service.create(
            self.session, workspace_id=1, host_user_id=9, name="Scrim", actor_user_id=9, member_ids=[7]
        )

        # Only the inherited role is copied; an unranked one stays unranked
        # rather than being invented from nothing.
        self.assertEqual(self.ranks.set_ranks.await_args.kwargs["ranks"], {"dps": 2400})

    async def test_seeding_skips_a_player_with_no_rank_anywhere(self) -> None:
        self.ranks.resolve.return_value = {}

        await self.service.create(
            self.session, workspace_id=1, host_user_id=9, name="Scrim", actor_user_id=9, member_ids=[7]
        )

        self.ranks.set_ranks.assert_not_awaited()

    async def test_update_roster_seeds_only_the_rows_it_created(self) -> None:
        self.games.get.return_value = _game()
        self.roster.list_for_game.return_value = [_roster_row(1, 7, 0)]
        self.ranks.resolve.return_value = _ranks(7, 8)

        await self.service.update_roster(
            self.session, workspace_id=1, custom_game_id=11, member_ids=[7, 8], actor_user_id=9
        )

        # 7 was already in the mix, so its book was seeded when it joined; only
        # the newcomer is resolved and written.
        self.assertEqual(self.ranks.resolve.await_args.kwargs["members"], {8: 80})
        self.assertEqual(
            [call.kwargs["workspace_member_id"] for call in self.ranks.set_ranks.await_args_list], [8]
        )

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

    async def test_set_team_names_stores_by_index(self) -> None:
        self.games.get.return_value = _game()

        game = await self.service.set_team_names(
            self.session,
            workspace_id=1,
            custom_game_id=11,
            team_names={"0": "  Wolves  ", "1": "Bears"},
            actor_user_id=9,
        )

        self.assertEqual(game.config_json, {"team_names": {"0": "Wolves", "1": "Bears"}})

    async def test_set_team_names_preserves_other_config_keys(self) -> None:
        self.games.get.return_value = _game(config_json={"role_mask": {"tank": 1}})

        game = await self.service.set_team_names(
            self.session, workspace_id=1, custom_game_id=11, team_names={"0": "Wolves"}, actor_user_id=9
        )

        self.assertEqual(game.config_json, {"role_mask": {"tank": 1}, "team_names": {"0": "Wolves"}})

    async def test_set_team_names_blank_value_clears_the_override(self) -> None:
        self.games.get.return_value = _game(config_json={"team_names": {"0": "Wolves", "1": "Bears"}})

        game = await self.service.set_team_names(
            self.session, workspace_id=1, custom_game_id=11, team_names={"0": "  "}, actor_user_id=9
        )

        # Only "1" survives; an empty override for "0" reverts it to the
        # computed default rather than being rejected.
        self.assertEqual(game.config_json, {"team_names": {"1": "Bears"}})

    async def test_set_team_names_dropping_every_entry_clears_the_config_key(self) -> None:
        self.games.get.return_value = _game(config_json={"team_names": {"0": "Wolves"}})

        game = await self.service.set_team_names(
            self.session, workspace_id=1, custom_game_id=11, team_names={"0": ""}, actor_user_id=9
        )

        self.assertIsNone(game.config_json)

    async def test_set_team_names_rejects_a_non_numeric_index(self) -> None:
        self.games.get.return_value = _game()
        with self.assertRaises(HTTPException) as ctx:
            await self.service.set_team_names(
                self.session, workspace_id=1, custom_game_id=11, team_names={"first": "Wolves"}, actor_user_id=9
            )
        self.assertEqual(ctx.exception.status_code, 422)

    async def test_set_team_names_rejects_an_out_of_range_index(self) -> None:
        self.games.get.return_value = _game()
        with self.assertRaises(HTTPException) as ctx:
            await self.service.set_team_names(
                self.session, workspace_id=1, custom_game_id=11, team_names={"8": "Wolves"}, actor_user_id=9
            )
        self.assertEqual(ctx.exception.status_code, 422)

    async def test_set_team_names_rejects_a_name_over_the_length_cap(self) -> None:
        self.games.get.return_value = _game()
        with self.assertRaises(HTTPException) as ctx:
            await self.service.set_team_names(
                self.session, workspace_id=1, custom_game_id=11, team_names={"0": "x" * 61}, actor_user_id=9
            )
        self.assertEqual(ctx.exception.status_code, 422)

    async def test_set_team_names_terminal_409(self) -> None:
        for status in ("completed", "cancelled"):
            with self.subTest(status=status):
                self.games.get.return_value = _row(
                    id=11, workspace_id=1, host_user_id=9, name="Scrim", status=status, config_json=None
                )
                with self.assertRaises(HTTPException) as ctx:
                    await self.service.set_team_names(
                        self.session, workspace_id=1, custom_game_id=11, team_names={"0": "Wolves"}, actor_user_id=9
                    )
                self.assertEqual(ctx.exception.status_code, 409)

    async def test_set_team_names_requires_the_host(self) -> None:
        self.games.get.return_value = _game()
        with self.assertRaises(HTTPException) as ctx:
            await self.service.set_team_names(
                self.session, workspace_id=1, custom_game_id=11, team_names={"0": "Wolves"}, actor_user_id=99
            )
        self.assertEqual(ctx.exception.status_code, 403)

    async def test_set_role_mask_stores_the_override(self) -> None:
        self.games.get.return_value = _game()

        game = await self.service.set_role_mask(
            self.session, workspace_id=1, custom_game_id=11, role_mask={"flex": 6}, actor_user_id=9
        )

        self.assertEqual(game.config_json, {"role_mask": {"flex": 6}})

    async def test_set_role_mask_preserves_other_config_keys(self) -> None:
        self.games.get.return_value = _game(config_json={"team_names": {"0": "Wolves"}})

        game = await self.service.set_role_mask(
            self.session, workspace_id=1, custom_game_id=11, role_mask={"tank": 1, "flex": 4}, actor_user_id=9
        )

        self.assertEqual(
            game.config_json, {"team_names": {"0": "Wolves"}, "role_mask": {"tank": 1, "flex": 4}}
        )

    async def test_set_role_mask_none_clears_the_override(self) -> None:
        self.games.get.return_value = _game(config_json={"role_mask": {"flex": 6}})

        game = await self.service.set_role_mask(
            self.session, workspace_id=1, custom_game_id=11, role_mask=None, actor_user_id=9
        )

        self.assertIsNone(game.config_json)

    async def test_set_role_mask_rejects_an_invalid_shape(self) -> None:
        self.games.get.return_value = _game()
        with self.assertRaises(HTTPException) as ctx:
            await self.service.set_role_mask(
                self.session, workspace_id=1, custom_game_id=11, role_mask={"healer": 6}, actor_user_id=9
            )
        self.assertEqual(ctx.exception.status_code, 422)

    async def test_set_role_mask_terminal_409(self) -> None:
        self.games.get.return_value = _row(
            id=11, workspace_id=1, host_user_id=9, name="Scrim", status="completed", config_json=None
        )
        with self.assertRaises(HTTPException) as ctx:
            await self.service.set_role_mask(
                self.session, workspace_id=1, custom_game_id=11, role_mask={"flex": 6}, actor_user_id=9
            )
        self.assertEqual(ctx.exception.status_code, 409)

    async def test_set_role_mask_requires_the_host(self) -> None:
        self.games.get.return_value = _game()
        with self.assertRaises(HTTPException) as ctx:
            await self.service.set_role_mask(
                self.session, workspace_id=1, custom_game_id=11, role_mask={"flex": 6}, actor_user_id=99
            )
        self.assertEqual(ctx.exception.status_code, 403)

    async def test_roster_shape_reports_the_override_source(self) -> None:
        shape = await self.service.roster_shape(
            self.session, workspace_id=1, config_json={"role_mask": {"flex": 6}}
        )
        self.assertEqual(shape.slots, {"flex": 6})
        self.assertEqual(shape.source, "tournament")

    async def test_roster_shape_falls_back_to_the_workspace_default(self) -> None:
        self.workspace_roster_slots.return_value = {"tank": 1, "flex": 5}

        shape = await self.service.roster_shape(self.session, workspace_id=1, config_json=None)

        self.assertEqual(shape.slots, {"tank": 1, "flex": 5})
        self.assertEqual(shape.source, "workspace")

    async def test_roster_shape_falls_back_to_the_builtin_default(self) -> None:
        shape = await self.service.roster_shape(self.session, workspace_id=1, config_json=None)

        self.assertEqual(shape.slots, {"tank": 1, "dps": 2, "support": 2})
        self.assertEqual(shape.source, "default")

    async def test_balance_uses_the_workspace_default_when_the_mix_has_no_override(self) -> None:
        self.workspace_roster_slots.return_value = {"flex": 6}
        self.games.get.return_value = _game()
        self.roster.list_for_game.return_value = [_roster_row(1, 7, 0)]
        self.ranks.resolve.return_value = _ranks(7)
        self.run_balance.return_value = {"teams": []}

        await self.service.balance(self.session, workspace_id=1, custom_game_id=11, actor_user_id=9)

        role_mask = self.run_balance.await_args.args[3]
        self.assertEqual(role_mask, {"flex": 6})

    async def test_balance_mix_override_wins_over_the_workspace_default(self) -> None:
        self.workspace_roster_slots.return_value = {"flex": 6}
        self.games.get.return_value = _game(config_json={"role_mask": {"tank": 1, "flex": 4}})
        self.roster.list_for_game.return_value = [_roster_row(1, 7, 0)]
        self.ranks.resolve.return_value = _ranks(7)
        self.run_balance.return_value = {"teams": []}

        await self.service.balance(self.session, workspace_id=1, custom_game_id=11, actor_user_id=9)

        role_mask = self.run_balance.await_args.args[3]
        self.assertEqual(role_mask, {"tank": 1, "flex": 4})

    async def test_balance_excludes_team_names_from_solver_config_overrides(self) -> None:
        game = _game(config_json={"team_names": {"0": "Wolves"}, "MMR_DIFF_WEIGHT": 5})
        self.games.get.return_value = game
        self.roster.list_for_game.return_value = [_roster_row(1, 7, 0)]
        self.ranks.resolve.return_value = _ranks(7)
        self.run_balance.return_value = {"teams": []}

        await self.service.balance(self.session, workspace_id=1, custom_game_id=11, actor_user_id=9)

        config_overrides = self.run_balance.await_args.args[1]
        self.assertEqual(config_overrides, {"MMR_DIFF_WEIGHT": 5})

    def _seat(
        self, uuid: str, name: str, rating: float, role: str, **overrides: object
    ) -> dict[str, object]:
        seat = {
            "uuid": uuid,
            "name": name,
            "assigned_rating": rating,
            "role_preferences": [role],
            "is_flex": False,
            "is_captain": False,
            "sub_role": None,
        }
        seat.update(overrides)
        return seat

    def _two_team_result(self) -> dict[str, object]:
        return {
            "variants": [
                {
                    "teams": [
                        {
                            "id": 1,
                            "average_mmr": 3050,
                            "roster": {
                                "tank": [self._seat("p1", "Alpha", 3200, "tank")],
                                "dps": [self._seat("p2", "Bravo", 2900, "dps")],
                            },
                        },
                        {
                            "id": 2,
                            "average_mmr": 2800,
                            "roster": {
                                "tank": [self._seat("p3", "Charlie", 2600, "tank")],
                                "dps": [self._seat("p4", "Delta", 3000, "dps")],
                            },
                        },
                    ],
                    "statistics": {
                        "composite_score": 0.87,
                        "mmr_std_dev": 10.0,
                        "max_total_rating_gap": 50,
                        "off_role_count": 0,
                    },
                    "benched_players": [],
                }
            ]
        }

    async def test_swap_seats_swaps_players_and_recomputes_stats(self) -> None:
        self.games.get.return_value = _game(result_json=self._two_team_result())

        game = await self.service.swap_seats(
            self.session,
            workspace_id=1,
            custom_game_id=11,
            variant_index=0,
            first_uuid="p1",
            second_uuid="p3",
            actor_user_id=9,
        )

        teams = game.result_json["variants"][0]["teams"]
        self.assertEqual(teams[0]["roster"]["tank"][0]["uuid"], "p3")
        self.assertEqual(teams[1]["roster"]["tank"][0]["uuid"], "p1")
        # Team 1 is now Charlie(2600)+Bravo(2900) = 5500/2 = 2750; team 2 is
        # now Alpha(3200)+Delta(3000) = 6200/2 = 3100.
        self.assertEqual(teams[0]["average_mmr"], 2750.0)
        self.assertEqual(teams[1]["average_mmr"], 3100.0)
        statistics = game.result_json["variants"][0]["statistics"]
        self.assertEqual(statistics["max_total_rating_gap"], 700.0)
        self.assertAlmostEqual(statistics["mmr_std_dev"], 247.487, places=2)
        self.assertEqual(statistics["off_role_count"], 0)
        # The knee-score is population-relative to the solver's Pareto archive
        # for that run -- meaningless for a single hand-edited arrangement, so
        # a manual swap clears it rather than leaving a now-fabricated number.
        self.assertIsNone(statistics["composite_score"])

    async def test_swap_seats_counts_off_role_after_the_move(self) -> None:
        result = self._two_team_result()
        # Bravo actually prefers tank but was seated at dps -- already off-role
        # before the swap, and moving them must not silently "fix" that count.
        result["variants"][0]["teams"][0]["roster"]["dps"][0]["role_preferences"] = ["tank", "dps"]
        self.games.get.return_value = _game(result_json=result)

        game = await self.service.swap_seats(
            self.session,
            workspace_id=1,
            custom_game_id=11,
            variant_index=0,
            first_uuid="p2",
            second_uuid="p4",
            actor_user_id=9,
        )

        statistics = game.result_json["variants"][0]["statistics"]
        self.assertEqual(statistics["off_role_count"], 1)

    async def test_swap_seats_rejects_different_roles(self) -> None:
        self.games.get.return_value = _game(result_json=self._two_team_result())
        with self.assertRaises(HTTPException) as ctx:
            await self.service.swap_seats(
                self.session,
                workspace_id=1,
                custom_game_id=11,
                variant_index=0,
                first_uuid="p1",
                second_uuid="p4",
                actor_user_id=9,
            )
        self.assertEqual(ctx.exception.status_code, 422)

    async def test_swap_seats_rejects_the_same_team(self) -> None:
        result = self._two_team_result()
        result["variants"][0]["teams"][0]["roster"]["tank"].append(self._seat("p5", "Echo", 3100, "tank"))
        self.games.get.return_value = _game(result_json=result)
        with self.assertRaises(HTTPException) as ctx:
            await self.service.swap_seats(
                self.session,
                workspace_id=1,
                custom_game_id=11,
                variant_index=0,
                first_uuid="p1",
                second_uuid="p5",
                actor_user_id=9,
            )
        self.assertEqual(ctx.exception.status_code, 422)

    async def test_swap_seats_rejects_an_unknown_player(self) -> None:
        self.games.get.return_value = _game(result_json=self._two_team_result())
        with self.assertRaises(HTTPException) as ctx:
            await self.service.swap_seats(
                self.session,
                workspace_id=1,
                custom_game_id=11,
                variant_index=0,
                first_uuid="p1",
                second_uuid="ghost",
                actor_user_id=9,
            )
        self.assertEqual(ctx.exception.status_code, 404)

    async def test_swap_seats_rejects_an_out_of_range_variant(self) -> None:
        self.games.get.return_value = _game(result_json=self._two_team_result())
        with self.assertRaises(HTTPException) as ctx:
            await self.service.swap_seats(
                self.session,
                workspace_id=1,
                custom_game_id=11,
                variant_index=3,
                first_uuid="p1",
                second_uuid="p3",
                actor_user_id=9,
            )
        self.assertEqual(ctx.exception.status_code, 404)

    async def test_swap_seats_terminal_409(self) -> None:
        for status in ("completed", "cancelled"):
            with self.subTest(status=status):
                self.games.get.return_value = _row(
                    id=11,
                    workspace_id=1,
                    host_user_id=9,
                    name="Scrim",
                    status=status,
                    result_json=self._two_team_result(),
                )
                with self.assertRaises(HTTPException) as ctx:
                    await self.service.swap_seats(
                        self.session,
                        workspace_id=1,
                        custom_game_id=11,
                        variant_index=0,
                        first_uuid="p1",
                        second_uuid="p3",
                        actor_user_id=9,
                    )
                self.assertEqual(ctx.exception.status_code, 409)

    async def test_swap_seats_requires_the_host(self) -> None:
        self.games.get.return_value = _game(result_json=self._two_team_result())
        with self.assertRaises(HTTPException) as ctx:
            await self.service.swap_seats(
                self.session,
                workspace_id=1,
                custom_game_id=11,
                variant_index=0,
                first_uuid="p1",
                second_uuid="p3",
                actor_user_id=99,
            )
        self.assertEqual(ctx.exception.status_code, 403)
