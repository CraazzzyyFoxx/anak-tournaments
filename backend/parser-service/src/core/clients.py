"""Process-global clients for the headless parser worker.

The HTTP service kept its S3 client on ``app.state.s3``; the typed-RPC handlers
have no request state, so the worker owns a module-level singleton instead.
``serve.py`` starts/stops it in the FastStream lifespan; rpc handlers and
services import the instances directly. Lives in ``core`` rather than ``rpc``
because ``services/subscription_collection/scheduler.py`` needs ``realtime_redis``,
and a service reaching up into the transport package would invert the layering.
"""

from __future__ import annotations

from redis.asyncio import Redis

from shared.clients import S3Client
from src.core import config

s3_client = S3Client.from_settings(config.settings)

# Realtime fan-in bus client (Redis pub/sub) shared by the match-log signal and
# any other worker-originated realtime publishes. Lazy-connects on first command;
# closed in the serve.py shutdown hook.
realtime_redis = Redis.from_url(str(config.settings.redis_url), decode_responses=True)
