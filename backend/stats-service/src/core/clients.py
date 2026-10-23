"""Process-global clients for the headless stats processes.

Typed-RPC handlers have no request state, so the clients are module-level singletons.
``serve_rpc.py`` and ``serve_worker.py`` start/stop them in the FastStream lifespan (``core/lifecycle.py``); rpc handlers
and services import the instances directly. Lives in ``core`` rather than ``rpc``
because ``services/subscription_collection/scheduler.py`` needs ``realtime_redis``,
and a service reaching up into the transport package would invert the layering.
"""

from __future__ import annotations

from redis.asyncio import Redis

from shared.clients import S3Client
from src.core import config

s3_client = S3Client.from_settings(config.settings)

# Redis client for worker-side coordination (the subscription scheduler's leader lock). Lazy-connects on first
# command; closed in the shutdown hook of each process.
realtime_redis = Redis.from_url(str(config.settings.redis_url), decode_responses=True)
