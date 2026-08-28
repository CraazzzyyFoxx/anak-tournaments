"""Shared test doubles for identity-service.

``FakeRedisClient``/``DownRedisClient`` were copy-pasted verbatim into four
test files (``test_oauth_callback_flow.py``, ``test_oauth_link_flow.py``,
``test_sso_tickets.py``, ``test_pending_link_tickets.py``). No behavioral
divergence between the copies -- single source of truth here.

``make_auth_user``/``make_workspace`` were hand-rolled identically as
``_owner``/``_user``/``_api_actor`` (three names, one ``AuthUser`` shape) and
``_workspace`` in ``test_api_key_credential.py``, ``test_api_key_service.py``,
and ``test_audit_identity.py``. ``FakeExecuteResult`` was hand-rolled
identically in ``test_api_key_service.py`` and ``test_auth_sessions.py``.
"""

from __future__ import annotations

import sys
from pathlib import Path
from types import SimpleNamespace

from redis.exceptions import ConnectionError as RedisConnectionError

# Same bootstrap the suites use, so this module is importable on its own
# rather than only after whichever test happened to be collected first
# patched `sys.path`.
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from src import models  # noqa: E402


class FakeRedisClient:
    """Dict-backed double: real ``set``/``getdel`` semantics, no TTL enforcement."""

    def __init__(self) -> None:
        self._store: dict[str, str] = {}

    async def set(self, key: str, value: str, ex: int | None = None) -> None:
        self._store[key] = value

    async def getdel(self, key: str) -> str | None:
        return self._store.pop(key, None)


class DownRedisClient:
    """Simulates an unreachable Redis for every op this module uses."""

    async def set(self, key: str, value: str, ex: int | None = None) -> None:
        raise RedisConnectionError("redis unavailable")

    async def getdel(self, key: str) -> str | None:
        raise RedisConnectionError("redis unavailable")


def make_auth_user(*, active: bool = True) -> models.AuthUser:
    """The standard ``ada@example.com``/``ada`` non-superuser, verified account."""
    return models.AuthUser(
        id=7,
        email="ada@example.com",
        username="ada",
        is_active=active,
        is_superuser=False,
        is_verified=True,
    )


def make_workspace(*, active: bool = True) -> models.Workspace:
    return models.Workspace(id=11, slug="main", name="Main", is_active=active)


class FakeExecuteResult:
    """A ``session.execute(...)`` result: ``scalar_one_or_none()`` or ``scalars().all()``."""

    def __init__(self, scalar: object = None, scalars: list | None = None) -> None:
        self._scalar = scalar
        self._scalars = list(scalars or [])

    def scalar_one_or_none(self) -> object:
        return self._scalar

    def scalars(self) -> SimpleNamespace:
        return SimpleNamespace(all=lambda: list(self._scalars))
