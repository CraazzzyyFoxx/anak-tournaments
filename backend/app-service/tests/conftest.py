from collections.abc import Generator

import pytest
from fastapi.testclient import TestClient
from main import app
from sqlalchemy.orm import Session
from src.core import db as _db


@pytest.fixture(scope="session", autouse=True)
def db() -> Generator[Session, None, None]:
    with _db.session_maker() as session:
        yield session


@pytest.fixture(scope="package")
def client() -> Generator[TestClient, None, None]:
    with TestClient(app) as c:
        yield c
