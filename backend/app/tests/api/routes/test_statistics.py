import pytest
from fastapi.testclient import TestClient
from src.core import config


@pytest.mark.parametrize(
    ("page", "per_page", "sort", "order", "entities"),
    [
        (1, 10, "id", "desc", []),
        (1, 25, "name", "desc", []),
        (1, 10, "value", "asc", []),
    ],
)
def test_get_champions(
    client: TestClient,
    page: int,
    per_page: int,
    sort: str,
    order: str,
    entities: list[str],
) -> None:
    response = client.get(
        f"{config.settings.api_v1_str}/statistics/champion",
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
    assert content["results"]
