"""RPC-handler test for hero playtime (``rpc.app.heroes.playtime``); the catalog reads are ``test_public_catalog.py``."""

import pytest

from tests.conftest import RpcHarness, build_query


@pytest.mark.parametrize(
    ("user_id", "page", "per_page", "sort", "order", "entities"),
    [
        ("all", 1, 10, "id", "desc", []),
        ("all", 1, 10, "playtime", "desc", []),
        (599, 1, 10, "id", "desc", []),
        (599, 1, 10, "playtime", "desc", []),
        (79, 1, 10, "id", "desc", []),
        (79, 1, 10, "playtime", "desc", []),
    ],
)
def test_get_hero_playtime(
    rpc: RpcHarness,
    user_id: int,
    page: int,
    per_page: int,
    sort: str,
    order: str,
    entities: list[str],
) -> None:
    env = rpc.call_sync(
        "rpc.app.heroes.playtime",
        {
            "query": build_query(
                {
                    "user_id": user_id,
                    "page": page,
                    "per_page": per_page,
                    "sort": sort,
                    "order": order,
                    "entities": entities,
                }
            )
        },
    )
    assert env["ok"] is True
    content = env["data"]
    assert content["page"] == page
    assert content["per_page"] == per_page
    if content["results"]:
        assert content["results"][0]["playtime"]
