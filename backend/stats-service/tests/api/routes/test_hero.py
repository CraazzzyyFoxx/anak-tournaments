"""RPC-handler test for one game's character playtime (``rpc.stats.statistics.character_playtime``).

The catalog reads are ``test_public_catalog.py``.
"""

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
def test_get_character_playtime(
    rpc: RpcHarness,
    user_id: int,
    page: int,
    per_page: int,
    sort: str,
    order: str,
    entities: list[str],
) -> None:
    env = rpc.call_sync(
        "rpc.stats.statistics.character_playtime",
        {
            "discipline": "overwatch",
            "query": build_query(
                {
                    "user_id": user_id,
                    "page": page,
                    "per_page": per_page,
                    "sort": sort,
                    "order": order,
                    "entities": entities,
                }
            ),
        },
    )
    assert env["ok"] is True
    content = env["data"]
    assert content["page"] == page
    assert content["per_page"] == per_page
    if content["results"]:
        assert content["results"][0]["playtime"]
        assert content["results"][0]["entity"]["discipline"] == "overwatch"


def test_character_playtime_never_defaults_the_game(rpc: RpcHarness) -> None:
    absent = rpc.call_sync("rpc.stats.statistics.character_playtime", {"query": build_query({"per_page": 1})})
    assert absent["ok"] is False
    assert absent["error"]["code"] == "unprocessable"

    unknown = rpc.call_sync(
        "rpc.stats.statistics.character_playtime", {"discipline": "chess", "query": build_query({"per_page": 1})}
    )
    assert unknown["ok"] is False
    assert unknown["error"]["code"] == "not_found"
    assert unknown["error"]["details"]["fields"][0]["code"] == "discipline_not_installed"
