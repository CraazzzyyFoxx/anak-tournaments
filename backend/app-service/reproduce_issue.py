import pytest
from fastapi.testclient import TestClient
from src.core import config
from src.main import app

client = TestClient(app)


def test_reproduce_500():
    user_id = 79
    response = client.get(
        f"{config.settings.api_v1_str}/users/{user_id}/teammates",
        params={
            "page": 1,
            "per_page": 25,
            "sort": "winrate",
            "order": "desc",
        },
    )
    print(f"Status: {response.status_code}")
    if response.status_code != 200:
        print(response.text)
    assert response.status_code == 200
