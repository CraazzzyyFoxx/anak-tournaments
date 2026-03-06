import pytest
from fastapi.testclient import TestClient

from src.core import config
from shared.core import enums

pytestmark = pytest.mark.validation


def test_performance_stat_is_treated_as_ascending() -> None:
    assert enums.is_ascending_stat(enums.LogStatsName.Performance) is True


def test_get_user_compare_target_user_missing(client: TestClient) -> None:
    response = client.get(
        f"{config.settings.api_v1_str}/users/599/compare",
        params={"baseline": "target_user"},
    )
    assert response.status_code == 400

    content = response.json()
    assert content["detail"][0]["code"] == "invalid_filter"


def test_get_user_compare_invalid_division_range(client: TestClient) -> None:
    response = client.get(
        f"{config.settings.api_v1_str}/users/599/compare",
        params={"baseline": "cohort", "div_min": 15, "div_max": 5},
    )
    assert response.status_code == 400

    content = response.json()
    assert content["detail"][0]["code"] == "invalid_filter"


def test_get_user_hero_compare_invalid_target_user_id_returns_422(client: TestClient) -> None:
    response = client.get(
        f"{config.settings.api_v1_str}/users/599/compare/heroes",
        params={"target_user_id": "not-a-number"},
    )
    assert response.status_code == 422

    content = response.json()
    assert content["detail"][0]["code"] == "unprocessable_entity"
    assert isinstance(content["detail"][0]["msg"], list)


def test_get_user_hero_compare_target_user_missing(client: TestClient) -> None:
    response = client.get(
        f"{config.settings.api_v1_str}/users/599/compare/heroes",
        params={"baseline": "target_user"},
    )
    assert response.status_code == 400

    content = response.json()
    assert content["detail"][0]["code"] == "invalid_filter"
