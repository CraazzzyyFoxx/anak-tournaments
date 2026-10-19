"""The app parity check requests the native per-game routes, each statistics read naming its game."""

from __future__ import annotations

import httpx

from scripts import app_parity_check as parity


def test_build_paths_reads_native_routes_of_one_named_game() -> None:
    client = httpx.Client(
        transport=httpx.MockTransport(lambda _request: httpx.Response(200, json={"results": [{"id": 5}]}))
    )
    paths = dict(parity.build_paths(client))
    prefix, game = parity.PREFIX, parity.CATALOG_DISCIPLINE

    assert not [path for path in paths if "/heroes" in path]
    assert f"{prefix}/statistics/{game}/characters/playtime" in paths
    assert f"{prefix}/statistics/{game}/characters/5/leaderboard" in paths
    game_reads = [
        f"{prefix}/users/overview",
        f"{prefix}/users/overview/stats",
        f"{prefix}/users/overview/catalog",
        f"{prefix}/statistics/champion",
        f"{prefix}/statistics/dashboard",
        f"{prefix}/users/5/characters",
        f"{prefix}/users/5/profile",
        f"{prefix}/users/5/teammates",
        f"{prefix}/users/5/compare",
    ]
    assert {path: paths[path].get("discipline") for path in game_reads} == dict.fromkeys(game_reads, game)
