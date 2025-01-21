import pytest
from fastapi.testclient import TestClient
from src.core import config


@pytest.mark.parametrize(
    ("page", "per_page", "sort", "order", "entities", "query", "fields"),
    [
        (1, 10, "id", "desc", [], "", []),
        (1, 25, "slug", "desc", [], "", []),
        (1, 10, "similarity:name", "asc", [], "han", ["name"]),
        (1, 10, "similarity:name", "desc", [], "hanzo", ["name"]),
    ],
)
def test_search_hero(
    client: TestClient,
    page: int,
    per_page: int,
    sort: str,
    order: str,
    entities: list[str],
    query: str,
    fields: list[str],
) -> None:
    response = client.get(
        f"{config.settings.api_v1_str}/heroes",
        params={
            "page": page,
            "per_page": per_page,
            "sort": sort,
            "order": order,
            "entities": entities,
            "query": query,
            "fields": fields,
        },
    )
    assert response.status_code == 200
    content = response.json()
    assert content["page"] == page
    assert content["per_page"] == per_page
    assert content["results"]

    if query:
        assert query in content["results"][0]["name"].lower()


@pytest.mark.parametrize(
    ("hero_id",),
    [
        (1,),
        (2,),
        (3,),
        (4,),
        (5,),
    ],
)
def test_get_hero_by_id(client: TestClient, hero_id: int) -> None:
    response = client.get(f"{config.settings.api_v1_str}/heroes/{hero_id}")
    assert response.status_code == 200
    content = response.json()
    assert content["id"] == hero_id


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
    client: TestClient,
    user_id: int,
    page: int,
    per_page: int,
    sort: str,
    order: str,
    entities: list[str],
) -> None:
    response = client.get(
        f"{config.settings.api_v1_str}/heroes/statistics/playtime",
        params={
            "user_id": user_id,
            "page": page,
            "per_page": per_page,
            "sort": sort,
            "order": order,
            "entities": entities,
        },
    )
    assert response.status_code == 200
    content = response.json()
    assert content["page"] == page
    assert content["per_page"] == per_page
    if content["results"]:
        assert content["results"][0]["playtime"]
