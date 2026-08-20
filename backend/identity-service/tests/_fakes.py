"""Shared test doubles for identity-service's Redis-backed ticket stores.

``_FakeRedisClient``/``_DownRedisClient`` were copy-pasted verbatim into four
test files (``test_oauth_callback_flow.py``, ``test_oauth_link_flow.py``,
``test_sso_tickets.py``, ``test_pending_link_tickets.py``). No behavioral
divergence between the copies — single source of truth here.
"""

from __future__ import annotations

from redis.exceptions import ConnectionError as RedisConnectionError


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
