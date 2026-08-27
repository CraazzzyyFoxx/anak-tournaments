"""Unified cashews cache setup for tests.

The cashews ``cache`` singleton is process-global with no default backend --
every entrypoint (each service's ``serve.py``) calls its own
``configure_cache()`` before any subscriber runs, or a cache read/write/
invalidation raises ``NotConfiguredError``. Tests that import cache-touching
code must configure the same singleton in-process.

Routes every known prefix to an in-memory (``mem://``) backend rather than a
service's real ``configure_cache()`` (which points at Redis via
``settings.*_cache_url``): tests get the exact same "every prefix is routable"
guarantee without depending on a reachable Redis, matching the rest of the
suite (CI runs with no external services -- see ``test-backend.yml``).
"""

from __future__ import annotations

from cashews import cache

#: Union of every prefix any service's ``configure_cache()`` registers --
#: see ``CACHE_PREFIXES``/``CACHE_LOCK_PREFIX``/``CACHE_PING_PREFIXES`` in
#: app-service/balancer-service/parser-service/tournament-service's
#: ``src/core/caching.py``. Configuring the full union up front means a test
#: importing any service's cache-decorated code never hits an unrouted
#: prefix, regardless of which subset that particular service registers.
_TEST_CACHE_PREFIXES: tuple[str, ...] = ("fastapi:", "backend:", "lock:", "LOCK", "PING")


def configure_test_cache(*extra_prefixes: str) -> None:
    """Route every known cashews prefix to an in-memory backend for tests."""
    for prefix in (*_TEST_CACHE_PREFIXES, *extra_prefixes):
        cache.setup("mem://", prefix=prefix)
