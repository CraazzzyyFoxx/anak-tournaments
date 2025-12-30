import pytest
from fastapi.testclient import TestClient
from src.core import config


@pytest.mark.parametrize(
    ("page", "per_page", "sort", "order", "entities", "query", "fields"),
    [
        (1, 10, "id", "desc", [], "", []),
        (1, 10, "name", "asc", [], "", []),
        (1, 25, "similarity:name", "desc", [], "nepal", ["name"]),
    ],
)
def test_search_map(
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
        f"{config.settings.api_v1_str}/maps",
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


# @pytest.mark.parametrize(
#     ("map_id", ),
#     [
#         (1, ),
#         (2, ),
#         (3, ),
#         (4, ),
#         (5, ),
#     ]
# )
# def test_get_map_by_id(client: TestClient, map_id: int) -> None:
#     response = client.get(f"{config.settings.api_v1_str}/maps/{map_id}")
#     assert response.status_code == 200
#     content = response.json()
#     assert content["id"] == map_id
#
#
# @pytest.mark.parametrize(
#     ("map_name", ),
#     [
#         ("Hanamura", ),
#         ("Paris", ),
#         ("Antarctic Peninsula", ),
#         ("Malevento", ),
#         ("Shambali Monastery", ),
#     ]
# )
# def test_get_map_by_id(client: TestClient, map_name: int) -> None:
#     response = client.get(f"{config.settings.api_v1_str}/maps/{map_name}")
#     assert response.status_code == 200
#     content = response.json()
#     assert content["id"] == map_name
