import pytest
from fastapi.testclient import TestClient
from src.core import config


@pytest.mark.parametrize(
    ("page", "per_page", "sort", "order", "entities", "query", "fields"),
    [
        (1, 10, "id", "desc", [], "", []),
        (1, 25, "id", "desc", [], "", []),
        (1, 10, "id", "desc", ["discord", "twitch", "battle_tag"], "", []),
        (
            1,
            10,
            "similarity:name",
            "asc",
            ["discord", "twitch", "battle_tag"],
            "craaz",
            ["name"],
        ),
    ],
)
def test_search_user(
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
        f"{config.settings.api_v1_str}/users",
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
    ("name", "entities"),
    [
        ("CraazzzyyFox-2130", []),
        ("CraazzzyyFox-2130", ["battle_tag"]),
        ("CraazzzyyFox-2130", ["battle_tag", "discord", "twitch"]),
        ("Zuuuuuuuuuuz-2690", []),
        ("Zuuuuuuuuuuz-2690", ["battle_tag"]),
        ("Zuuuuuuuuuuz-2690", ["battle_tag", "discord", "twitch"]),
        ("Anak-2894", []),
        ("Anak-2894", ["battle_tag"]),
        ("Anak-2894", ["battle_tag", "discord", "twitch"]),
        ("marmeladka-21557", []),
        ("marmeladka-21557", ["battle_tag"]),
        ("marmeladka-21557", ["battle_tag", "discord", "twitch"]),
    ],
)
def test_get_user_by_name(client: TestClient, name: str, entities: list[str]) -> None:
    response = client.get(
        f"{config.settings.api_v1_str}/users/{name}", params={"entities": entities}
    )
    assert response.status_code == 200
    content = response.json()
    assert content["name"] == name.replace("-", "#")
    if "battle_tag" in entities:
        assert content["battle_tag"] != []
    if "twitch" in entities:
        assert content["twitch"] != []


@pytest.mark.parametrize(
    ("user_id",),
    [
        (599,),
        (79,),
        (461,),
        (583,),
    ],
)
def test_get_user_profile(client: TestClient, user_id: int) -> None:
    response = client.get(f"{config.settings.api_v1_str}/users/{user_id}/profile")
    assert response.status_code == 200
    content = response.json()
    assert content["tournaments"].__len__() >= 0


@pytest.mark.parametrize(
    ("user_id",),
    [
        (599,),
        (79,),
        (461,),
        (583,),
    ],
)
def test_get_user_tournaments(client: TestClient, user_id: int) -> None:
    response = client.get(f"{config.settings.api_v1_str}/users/{user_id}/tournaments")
    assert response.status_code == 200
    content = response.json()
    assert content.__len__() >= 0


@pytest.mark.parametrize(
    ("user_id", "tournament_id"),
    [
        (599, 36),
        (79, 3),
        (461, 10),
        (583, 18),
    ],
)
def test_get_user_tournament(
    client: TestClient, user_id: int, tournament_id: int
) -> None:
    response = client.get(
        f"{config.settings.api_v1_str}/users/{user_id}/tournaments/{tournament_id}"
    )
    assert response.status_code == 200
    content = response.json()
    assert content.__len__() >= 0


@pytest.mark.parametrize(
    ("user_id", "tournament_id"),
    [
        (599, 3),
        (79, 36),
        (461, 14),
        (583, 14),
    ],
)
def test_get_user_tournament_not_found(
    client: TestClient, user_id: int, tournament_id: int
) -> None:
    response = client.get(
        f"{config.settings.api_v1_str}/users/{user_id}/tournaments/{tournament_id}"
    )
    assert response.status_code == 404
    content = response.json()
    assert content["detail"][0]["code"] == "not_found"


@pytest.mark.parametrize(
    ("user_id", "page", "per_page", "sort", "order", "entities"),
    [
        (599, 1, 10, "id", "desc", []),
        (599, 1, 25, "created_at", "desc", ["gamemode"]),
        (79, 1, 10, "id", "desc", []),
        (461, 1, 10, "name", "desc", []),
        (461, 1, 25, "gamemode_id", "desc", ["gamemode"]),
        (583, 1, 10, "image_path", "desc", []),
        (583, 1, 25, "slug", "desc", ["gamemode"]),
    ],
)
def test_get_user_maps(
    client: TestClient,
    user_id: int,
    page: int,
    per_page: int,
    sort: str,
    order: str,
    entities: list[str],
) -> None:
    response = client.get(
        f"{config.settings.api_v1_str}/users/{user_id}/maps",
        params={
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

    if "gamemode" in entities:
        assert content["results"][0]["map"]["gamemode"]
    else:
        if content["results"]:
            assert content["results"][0]["map"]["gamemode"] is None


@pytest.mark.parametrize(
    ("user_id", "page", "per_page", "sort", "order", "entities"),
    [
        (599, 1, 10, "id", "desc", []),
        (599, 1, 25, "created_at", "desc", ["tournament"]),
        # (599, 1, 25, "name", "desc", ["tournament", "teams", "teams.players"]),
        (599, 1, 25, "updated_at", "desc", ["tournament", "teams"]),
        (79, 1, 10, "id", "desc", []),
        (79, 1, 25, "home_team_id", "desc", ["tournament"]),
        # (79, 1, 25, "away_team_id", "desc", ["tournament", "teams", "teams.players"]),
        (79, 1, 25, "has_logs", "desc", ["tournament", "teams"]),
        (461, 1, 10, "name", "desc", []),
        (461, 1, 25, "round", "desc", ["tournament"]),
        # (461, 1, 25, "away_team_id", "desc", ["tournament", "teams", "teams.players"]),
        (461, 1, 25, "home_team_id", "desc", ["tournament", "teams"]),
        (583, 1, 10, "closeness", "desc", []),
        (583, 1, 25, "has_logs", "desc", ["tournament"]),
        # (583, 1, 25, "tournament_id", "desc", ["tournament", "teams", "teams.players"]),
        (583, 1, 25, "round", "desc", ["tournament", "teams"]),
    ],
)
def test_get_user_encounters(
    client: TestClient,
    user_id: int,
    page: int,
    per_page: int,
    sort: str,
    order: str,
    entities: list[str],
) -> None:
    response = client.get(
        f"{config.settings.api_v1_str}/users/{user_id}/encounters",
        params={
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

    if "teams" in entities:
        assert content["results"][0]["home_team"]
        assert content["results"][0]["away_team"]

        if "teams.players" in entities:
            assert content["results"][0]["home_team"]["players"]
            assert content["results"][0]["away_team"]["players"]
        else:
            if content["results"]:
                assert content["results"][0]["home_team"]["players"] == []
                assert content["results"][0]["away_team"]["players"] == []

    else:
        if content["results"]:
            assert content["results"][0]["home_team"] is None
            assert content["results"][0]["away_team"] is None

    if "tournament" in entities:
        assert content["results"][0]["tournament"]
    else:
        if content["results"]:
            assert content["results"][0]["tournament"] is None


@pytest.mark.parametrize(("user_id",), [(599,), (79,), (461,), (583,)])
def test_get_user_heroes(client: TestClient, user_id: int) -> None:
    response = client.get(
        f"{config.settings.api_v1_str}/users/{user_id}/heroes",
    )
    assert response.status_code == 200


@pytest.mark.parametrize(
    ("user_id", "page", "per_page", "sort", "order"),
    [
        (
            599,
            1,
            10,
            "id",
            "asc",
        ),
        (599, 1, 25, "winrate", "desc"),
        (599, 1, 25, "winrate", "asc"),
        (
            79,
            1,
            10,
            "id",
            "asc",
        ),
        (79, 1, 25, "winrate", "desc"),
        (79, 1, 25, "winrate", "asc"),
        (
            461,
            1,
            10,
            "id",
            "asc",
        ),
        (461, 1, 25, "winrate", "desc"),
        (461, 1, 25, "winrate", "asc"),
        (
            583,
            1,
            10,
            "id",
            "asc",
        ),
        (583, 1, 25, "winrate", "desc"),
        (583, 1, 25, "winrate", "asc"),
    ],
)
def test_get_user_teammates(
    client: TestClient, user_id: int, page: int, per_page: int, sort: str, order: str
) -> None:
    response = client.get(
        f"{config.settings.api_v1_str}/users/{user_id}/teammates",
        params={
            "page": page,
            "per_page": per_page,
            "sort": sort,
            "order": order,
        },
    )
    assert response.status_code == 200
    content = response.json()
    assert content["page"] == page
    assert content["per_page"] == per_page

    if content["results"] and "winrate" == sort:
        if order == "desc":
            assert content["results"][0]["winrate"] >= content["results"][-1]["winrate"]
        else:
            assert content["results"][0]["winrate"] <= content["results"][-1]["winrate"]
