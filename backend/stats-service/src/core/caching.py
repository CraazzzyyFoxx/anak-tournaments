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


def configure_cache() -> None:
    """Configure the cashews cache backends for the current process.

    The cashews ``cache`` singleton is process-global, so every entrypoint that
    can read/write the cache -- or trigger cache invalidation -- must call this
    (``core/lifecycle.py`` does for ``serve_rpc.py``/``serve_worker.py``; CLIs call it themselves).
    """
    cache.setup(f"{config.settings.redis_url}/4", prefix="backend:")
