"""RPC-handler tests for the gamemode surface.

Targets:
- list -> ``rpc.app.read.list`` (entity=gamemode, shared CRUD read engine)
- get  -> ``rpc.app.read.get``  (entity=gamemode)

Replaces the former HTTP-client tests against the decommissioned HTTP service;
assertions mirror the old tests on the envelope ``data``.
"""

import pytest
from sqlalchemy.orm import Session

from src import models
from tests.conftest import RpcHarness, build_query


@pytest.mark.parametrize(
    ("page", "per_page", "sort", "order", "entities", "query", "fields"),
    [
        (1, 10, "id", "desc", [], "", []),
        (1, 25, "slug", "desc", [], "", []),
        (1, 10, "name", "asc", [], "", []),
        (1, 10, "similarity:name", "asc", [], "assault", ["name"]),
    ],
)
def test_search_gamemode(
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
        "rpc.app.read.list",
        {
            "entity": "gamemode",
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
            ),
        },
    )
    assert env["ok"] is True
    content = env["data"]
    assert content["page"] == page
    assert content["per_page"] == per_page
    assert content["results"]

    if query:
        assert query in content["results"][0]["name"].lower()


@pytest.mark.parametrize("mode_offset", range(5))
def test_get_gamemode_by_id(rpc: RpcHarness, db: Session, mode_offset: int) -> None:
    gamemode_id = (
        db.query(models.CatalogEntity.id)
        .filter_by(discipline="overwatch", kind="mode")
        .order_by(models.CatalogEntity.id)
        .offset(mode_offset)
        .limit(1)
        .scalar()
    )
    assert gamemode_id is not None, f"fixture DB has no catalog mode at offset {mode_offset}"
    env = rpc.call_sync("rpc.app.read.get", {"entity": "gamemode", "id": gamemode_id})
    assert env["ok"] is True
    content = env["data"]
    assert content["id"] == gamemode_id
