"""Generation-versioned cache keys: an invalidation is one SET per generation, never a keyspace SCAN.

A cached read names the generations it depends on, and their current values are part of its key. Bumping a
generation makes every key built from its old value unreachable; those entries age out on their own TTL.

The generations live in the one Redis every service already shares (the realtime rail's, see
``configure_realtime``), so a writer moves another service's cache the moment it bumps — synchronously after its
commit — instead of when an event reaches that service.

Values are random, not counted: Redis runs ``allkeys-lru``, so a generation can be evicted, and one re-created
from a counter would start over at a value some live entry was built from. A fresh random value never repeats one.
"""

from __future__ import annotations

import functools
import secrets
from collections.abc import Awaitable, Callable, Sequence
from typing import Any, ParamSpec, TypeVar

from cashews import cache, key_context
from cashews.exceptions import CacheBackendInteractionError
from cashews.formatter import default_format
from cashews.key import get_call_values

__all__ = ("PREFIX", "bump", "configure_generations", "current", "versioned")

PREFIX = "cachegen:"
# A generation nobody bumps for this long is re-created with a fresh value: one miss per idle scope, and no key
# per tournament/user ever touched kept forever.
_TTL_SECONDS = 7 * 24 * 60 * 60

P = ParamSpec("P")
R = TypeVar("R")


def configure_generations(redis_url: str) -> None:
    """Route the generations to the shared Redis. ``suppress=False``: a failed bump or read must surface, not be
    taken for "nothing to invalidate" / "generation unknown" (cashews' default swallows the error)."""
    cache.setup(redis_url, prefix=PREFIX, suppress=False)


def _fresh() -> str:
    return secrets.token_hex(6)


async def bump(*names: str) -> None:
    """Move each generation to a fresh value: every cached read keyed by an old one is never asked for again."""
    if names:
        await cache.set_many({PREFIX + name: _fresh() for name in names}, expire=_TTL_SECONDS)


async def current(*names: str) -> str:
    """The generations' current values, joined into one key component. A missing one is created (``SET NX``, so
    concurrent readers agree on it)."""
    keys = [PREFIX + name for name in names]
    values = list(await cache.get_many(*keys))
    for index, value in enumerate(values):
        if value is None:
            fresh = _fresh()
            created = await cache.set(keys[index], fresh, expire=_TTL_SECONDS, exist=False)
            values[index] = fresh if created else await cache.get(keys[index])
    return ".".join(map(str, values))


def versioned(
    *, generations: Sequence[str], key: str, **options: Any
) -> Callable[[Callable[P, Awaitable[R]]], Callable[P, Awaitable[R]]]:
    """``@cache(key=key, **options)`` whose key also carries the current value of each of ``generations``.

    ``generations`` are templates over the call's arguments, written like ``key``
    (``"tournament:{params.tournament_id}:tournament.teams"``). When the generations cannot be read the call
    bypasses the cache: an entry looked up without them could be from before any invalidation.
    """

    def decorator(func: Callable[P, Awaitable[R]]) -> Callable[P, Awaitable[R]]:
        # cashews checks a key's placeholders against the function's parameters as it decorates; ``{@:get(gen)}``
        # reads the template context instead, which only the call below fills in.
        with key_context(gen=""):
            cached = cache(key=f"{key}:{{@:get(gen)}}", **options)(func)

        @functools.wraps(func)
        async def wrapper(*args: P.args, **kwargs: P.kwargs) -> R:
            values = get_call_values(func, args, kwargs)
            try:
                token = await current(*(default_format(template, **values) for template in generations))
            except CacheBackendInteractionError:
                return await func(*args, **kwargs)
            with key_context(gen=token):
                return await cached(*args, **kwargs)

        return wrapper

    return decorator
