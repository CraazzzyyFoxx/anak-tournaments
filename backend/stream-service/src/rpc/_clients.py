"""Process-global clients for the headless stream worker.

The typed-RPC handlers have no request state, so the worker owns a module-level
singleton instead. Lazy-connects on first command; closed in the ``serve.py``
shutdown hook.

Redis is this service's *only* datastore: live status lives in
``stream:live:{tournament_id}`` (see ``src.services.state``), the Helix app token
in ``stream:token``, and the poll cursor in ``stream:poll:last_run``. It is also
the realtime fan-in bus the poller publishes ``stream.updated`` onto.
"""

from __future__ import annotations

from redis.asyncio import Redis

from src.core import config

realtime_redis = Redis.from_url(str(config.settings.redis_url), decode_responses=True)
