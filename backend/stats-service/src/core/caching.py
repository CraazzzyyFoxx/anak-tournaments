from __future__ import annotations

from cashews import cache

from src.core import config

# The cache-key prefixes this service registers.
#
# cashews has no default backend: it routes every operation (get/set/delete_match)
# to the backend whose registered prefix the key starts with, and raises
# ``NotConfiguredError`` for keys that match no prefix. Any invalidation pattern
# must therefore start with a registered prefix.
CACHE_PREFIXES: tuple[str, ...] = ("backend:",)
# cashews prepends ``lock:`` to a decorated cache key when ``lock=True`` (the
# compare/encounters/characters reads). The lock namespace must be registered
# explicitly or stampede protection cannot route its operations.
CACHE_LOCK_PREFIX = "lock:"
# ...and the lock is not enough on its own: ``Backend.lock()`` health-probes the
# connection with ``ping(b"LOCK")``, while ``Cache.ping`` routes by the *decoded
# message* as if it were a cache key (cashews 7.4: wrapper/commands.py). So the
# probe looks up a backend for the literal key ``"LOCK"`` -- unroutable without a
# default backend, so every ``lock=True`` read would raise NotConfiguredError
# instead of serving the cache. ``"PING"`` is the message a bare ``cache.ping()``
# health check sends; registered for the same reason.
CACHE_PING_PREFIXES: tuple[str, ...] = ("LOCK", "PING")


def backend_cache_url() -> str:
    return f"{config.settings.redis_url}/4"


def configure_cache() -> None:
    """Configure the cashews cache backends for the current process.

    The cashews ``cache`` singleton is process-global, so every entrypoint that
    can read/write the cache -- or trigger cache invalidation -- must call this
    (``core/lifecycle.py`` does for ``serve_rpc.py``/``serve_worker.py``; CLIs call it themselves).
    """
    url = backend_cache_url()
    for prefix in (*CACHE_PREFIXES, CACHE_LOCK_PREFIX, *CACHE_PING_PREFIXES):
        cache.setup(url, prefix=prefix)
