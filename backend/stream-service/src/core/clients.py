"""Process-global Redis client; lazy-connects on first command.

Redis holds this service's own state: live status in ``stream:live:{tournament_id}``
(see ``src.services.state``), the Helix app token in ``stream:token``, and the poll
cursor in ``stream:poll:last_run``. It is also the realtime fan-in bus the poller
publishes ``stream.updated`` onto.
"""

from __future__ import annotations

from redis.asyncio import Redis

from src.core import config

realtime_redis = Redis.from_url(str(config.settings.redis_url), decode_responses=True)
