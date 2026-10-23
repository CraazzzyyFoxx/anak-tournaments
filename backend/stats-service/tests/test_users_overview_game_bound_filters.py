"""Without a game the users index refuses the filters that only mean something inside one game (spec §8.2).

DB-free: the refusal happens before the handler reads anything.
"""

from __future__ import annotations

import json

import pytest

from src.rpc import users
from tests.conftest import RpcHarness, build_query

_HARNESS = RpcHarness().register(users)

_TOPICS = ("rpc.stats.users.overview", "rpc.stats.users.overview_stats", "rpc.stats.users.overview_catalog")
_GAME_BOUND = (
    ("role", json.dumps({"dimension": "player_role", "role": "tank"})),
    ("divisions", [3]),
)


@pytest.mark.parametrize("topic", _TOPICS)
@pytest.mark.parametrize(("param", "value"), _GAME_BOUND)
def test_a_game_bound_filter_without_a_game_is_a_422_naming_it(topic: str, param: str, value: object) -> None:
    env = _HARNESS.call_sync(topic, {"query": build_query({"workspace_id": "all", param: value})})

    assert env["ok"] is False, env
    assert env["error"]["code"] == "unprocessable"
    assert env["error"]["message"] == f"{param} requires discipline"
