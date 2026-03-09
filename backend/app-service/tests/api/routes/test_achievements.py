import pytest
from fastapi.testclient import TestClient
from src.core import config


@pytest.mark.parametrize(
    ("page", "per_page", "sort", "order", "entities", "query", "fields"),
    [
        (1, 10, "id", "desc", [], "", []),
        (1, 25, "slug", "desc", [], "", []),
        (1, 10, "name", "asc", [], "", []),
        (1, 10, "rarity", "asc", [], "", []),
    ],
)
def test_search_achievement(
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
        f"{config.settings.api_v1_str}/achievements",
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
    ("achievement_id",),
    [
        (1,),
        (2,),
        (3,),
        (4,),
        (5,),
    ],
)
def test_get_achievement_by_id(client: TestClient, achievement_id: int) -> None:
    response = client.get(f"{config.settings.api_v1_str}/achievements/{achievement_id}")
    assert response.status_code == 200
    content = response.json()
    assert content["id"] == achievement_id


@pytest.mark.parametrize(
    ("user_id",),
    [
        (599,),
        (79,),
        (461,),
        (583,),
    ],
)
def test_get_achievement_by_user(client: TestClient, user_id: int) -> None:
    response = client.get(f"{config.settings.api_v1_str}/achievements/user/{user_id}")
    assert response.status_code == 200
    content = response.json()
    assert content.__len__() > 0


@pytest.mark.parametrize(
    ("user_id",),
    [
        (599,),
        (79,),
        (461,),
        (583,),
    ],
)
def test_get_achievement_by_user_filter_without_tournament(client: TestClient, user_id: int) -> None:
    response = client.get(
        f"{config.settings.api_v1_str}/achievements/user/{user_id}",
        params={"without_tournament": True},
    )
    assert response.status_code == 200
    content = response.json()

    for achievement in content:
        assert achievement["tournaments_ids"] == []


@pytest.mark.parametrize(
    ("user_id",),
    [
        (599,),
        (79,),
        (461,),
        (583,),
    ],
)
def test_get_achievement_by_user_filter_tournament(client: TestClient, user_id: int) -> None:
    initial_response = client.get(f"{config.settings.api_v1_str}/achievements/user/{user_id}")
    assert initial_response.status_code == 200
    initial_content = initial_response.json()

    tournament_id = None
    for achievement in initial_content:
        if achievement["tournaments_ids"]:
            tournament_id = achievement["tournaments_ids"][0]
            break

    if tournament_id is None:
        tournament_id = -1

    response = client.get(
        f"{config.settings.api_v1_str}/achievements/user/{user_id}",
        params={"tournament_id": tournament_id},
    )
    assert response.status_code == 200
    content = response.json()

    for achievement in content:
        assert tournament_id in achievement["tournaments_ids"]


def test_get_achievement_by_user_filter_conflict(client: TestClient) -> None:
    response = client.get(
        f"{config.settings.api_v1_str}/achievements/user/599",
        params={"tournament_id": 1, "without_tournament": True},
    )
    assert response.status_code == 400
