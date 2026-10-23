"""A module declares its native rank layer; the core asks the registry (D87, D99)."""

from __future__ import annotations

import asyncio
from unittest.mock import AsyncMock, patch

from shared.disciplines import DISCIPLINES, rated_role_codes
from shared.disciplines.overwatch.ranks import best_rank_per_role


def test_both_games_declare_a_native_rank_layer() -> None:
    assert DISCIPLINES["overwatch"].native_ranks is not None
    assert DISCIPLINES["lol"].native_ranks is not None


def test_the_overwatch_layer_keeps_a_players_best_rank_per_role_across_accounts() -> None:
    accounts = {10: {"Main#1": {"tank": 1800, "support": 2500}, "Smurf#2": {"tank": 2900}}, 11: {}}
    assert best_rank_per_role(accounts) == {10: {"tank": 2900, "support": 2500}}
    fetch = AsyncMock(return_value=accounts)
    with patch("shared.services.rank_snapshots.fetch_latest_ow_ranks_by_account", new=fetch):
        assert asyncio.run(DISCIPLINES["overwatch"].native_ranks(None, (11, 10))) == {
            10: {"tank": 2900, "support": 2500}
        }
    assert fetch.await_args.args[1] == [11, 10]


def test_rated_role_codes_follow_the_module_declaration() -> None:
    assert rated_role_codes("overwatch") == ("tank", "damage", "support")
    assert rated_role_codes("lol") == ("top", "jungle", "mid", "bot", "support")
