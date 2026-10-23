"""RPC-handler tests for the profile's cross-game tabs (``rpc.stats.users.tournaments`` / ``.encounters``)."""

import pytest

from tests.conftest import RpcHarness, build_query

TABS = ("rpc.stats.users.tournaments", "rpc.stats.users.encounters")


def test_mvp1_without_a_game_is_a_422_naming_the_parameter(rpc: RpcHarness) -> None:
    env = rpc.call_sync(
        "rpc.stats.users.encounters", {"id": 1, "query": build_query({"mvp1": True, "workspace_id": "all"})}
    )
    assert env["ok"] is False
    assert env["error"]["code"] == "unprocessable"
    assert env["error"]["message"] == "mvp1 requires discipline"


@pytest.mark.parametrize("topic", TABS)
def test_an_unknown_game_is_404_never_every_game(rpc: RpcHarness, topic: str) -> None:
    env = rpc.call_sync(topic, {"id": 1, "query": build_query({"discipline": "chess", "workspace_id": "all"})})
    assert env["ok"] is False
    assert env["error"]["code"] == "not_found"
    assert env["error"]["details"]["fields"][0]["code"] == "discipline_not_installed"
