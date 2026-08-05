"""The service's Redis client for realtime fan-out.

One lazily built client, not one per publish: a fresh ``Redis.from_url`` per event
opens a TCP connection per mutation, and the connection pool behind a single
instance is the whole point of the class.

Deliberately narrow — realtime publishing only. The distributed lock in
``services.challonge.sync`` and the redeem rate limiter in
``services.registration.subscription_status`` keep their own clients: they fail
differently (a lock that cannot be taken must abort, a missed invalidation must
not) and folding them together would hand one failure mode to the other.
"""

from __future__ import annotations

from redis.asyncio import Redis

from src.core import config

__all__ = ("close_realtime_redis", "get_realtime_redis")

_client: Redis | None = None


def get_realtime_redis() -> Redis:
    global _client
    if _client is None:
        _client = Redis.from_url(str(config.settings.redis_url), decode_responses=True)
    return _client


async def close_realtime_redis() -> None:
    global _client
    if _client is None:
        return
    await _client.aclose()
    _client = None
