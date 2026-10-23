"""RPC-handler tests for the users identity reads app-service keeps.

- ``GET /users``         -> ``rpc.app.users.list``
- ``GET /users/{name}``  -> ``rpc.app.users.by_name``

The statistics reads of ``/users/*`` moved to stats-service (``rpc.stats.users.*``,
``stats-service/tests/api/routes/test_user.py``).
"""

import pytest

from tests.conftest import RpcHarness, build_query


@pytest.mark.parametrize(
    ("page", "per_page", "sort", "order", "entities", "query", "fields"),
    [
        (1, 10, "id", "desc", [], "", []),
        (1, 25, "id", "desc", [], "", []),
        (1, 10, "id", "desc", ["social_accounts"], "", []),
        (
            1,
            10,
            "similarity:name",
            "asc",
            ["social_accounts"],
            "craaz",
            ["name"],
        ),
    ],
)
def test_search_user(
    rpc: RpcHarness,
    page: int,
    per_page: int,
    sort: str,
    order: str,
    entities: list[str],
    query: str,
    fields: list[str],
) -> None:
    env = rpc.call_sync(
        "rpc.app.users.list",
        {
            "query": build_query(
                {
                    "page": page,
                    "per_page": per_page,
                    "sort": sort,
                    "order": order,
                    "entities": entities,
                    "query": query,
                    "fields": fields,
                }
            )
        },
    )
    assert env["ok"] is True
    content = env["data"]
    assert content["page"] == page
    assert content["per_page"] == per_page
    assert content["results"]

    if query:
        assert query in content["results"][0]["name"].lower()


@pytest.mark.parametrize(
    ("name", "entities"),
    [
        ("CraazzzyyFox-2130", []),
        ("CraazzzyyFox-2130", ["social_accounts"]),
        ("Zuuuuuuuuuuz-2690", []),
        ("Zuuuuuuuuuuz-2690", ["social_accounts"]),
        ("Anak-2894", []),
        ("Anak-2894", ["social_accounts"]),
        ("marmeladka-21557", []),
        ("marmeladka-21557", ["social_accounts"]),
    ],
)
def test_get_user_by_name(rpc: RpcHarness, name: str, entities: list[str]) -> None:
    env = rpc.call_sync(
        "rpc.app.users.by_name",
        {"name": name, "query": build_query({"entities": entities})},
    )
    assert env["ok"] is True
    content = env["data"]
    assert content["name"] == name.replace("-", "#")
    if "social_accounts" in entities:
        assert any(s["provider"] == "battlenet" for s in content["social_accounts"])
        assert any(s["provider"] == "twitch" for s in content["social_accounts"])
