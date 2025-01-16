import pytest
from fastapi.testclient import TestClient
from src.core import config


@pytest.mark.parametrize(
    ("page", "per_page", "sort", "order", "entities", "query", "fields"),
    [
        (1, 10, "id", "desc", [], "", []),
        (1, 25, "number", "desc", [], "", []),
        (1, 10, "start_date", "asc", [], "", []),
        (1, 10, "end_date", "asc", [], "", []),
        (1, 10, "similarity:name", "desc", [], "OWAL Season 2", ["name"]),
    ],
)
def test_search_tournament(
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
        f"{config.settings.api_v1_str}/tournaments",
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
        assert query in content["results"][0]["name"]


@pytest.mark.parametrize(
    ("tournament_id",),
    [
        (1,),
        (2,),
        (3,),
        (4,),
        (5,),
    ],
)
def test_get_tournament_by_id(client: TestClient, tournament_id: int) -> None:
    response = client.get(f"{config.settings.api_v1_str}/tournaments/{tournament_id}")
    assert response.status_code == 200
    content = response.json()
    assert content["id"] == tournament_id


def test_get_tournament_history(client: TestClient) -> None:
    response = client.get(
        f"{config.settings.api_v1_str}/tournaments/statistics/history"
    )
    assert response.status_code == 200
    content = response.json()
    assert content


def test_get_tournament_division(client: TestClient) -> None:
    response = client.get(
        f"{config.settings.api_v1_str}/tournaments/statistics/division"
    )
    assert response.status_code == 200
    content = response.json()
    assert content


def test_get_tournament_overall(client: TestClient) -> None:
    response = client.get(
        f"{config.settings.api_v1_str}/tournaments/statistics/overall"
    )
    assert response.status_code == 200
    content = response.json()
    assert content


@pytest.mark.parametrize(
    ("tournament_id", "entities"),
    [
        (44, []),
        (44, ["group", "tournament", "team", "matches_history"]),
        (43, []),
        (43, ["group", "tournament", "team", "matches_history"]),
        (10, []),
        (10, ["group", "tournament", "team", "matches_history"]),
        (21, []),
        (21, ["group", "tournament", "team", "matches_history"]),
        (35, []),
        (35, ["group", "tournament", "team", "matches_history"]),
        (2, []),
        (2, ["group", "tournament", "team", "matches_history"]),
    ],
)
def test_get_tournament_standings(
    client: TestClient, tournament_id: int, entities: list[str]
) -> None:
    response = client.get(
        f"{config.settings.api_v1_str}/tournaments/{tournament_id}/standings",
        params={"entities": entities},
    )
    assert response.status_code == 200
    content = response.json()
    assert content


def test_get_owal_standings(client: TestClient) -> None:
    response = client.get(f"{config.settings.api_v1_str}/tournaments/owal/results")
    assert response.status_code == 200
    content = response.json()
    assert content
