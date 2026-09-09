"""Thin realtime signal for pickup-mix roster/rank changes.

A ``pickup_mix.updated`` broadcast on ``workspace:{id}:pickup_mix``. It carries
no row data -- only "something in this workspace's mixes changed, refetch" --
for the same reason ``subscription.updated`` does (see
``shared.services.subscriptions.realtime``):

- A roster edit, a bench toggle, a rank correction and a newly-seeded host rank
  all collapse into the same two refetches on the consumer side (the
  add-players dialog's roster/rank queries, the mix panels' custom-game query),
  so there is nothing worth threading through that the client's own
  authoritative reload does not already answer.
- Non-durable (``event_id=0``, no persisted row): a client that reconnects
  refetches anyway, so persisting one row per edit would buy nothing.

Only balancer-service ever writes this signal (custom-game roster/lineup
edits, workspace rank writes), so it lives here rather than in ``shared``.
"""

from __future__ import annotations

from datetime import UTC, datetime

from loguru import logger
from redis.asyncio import Redis

from shared.schemas.realtime import WorkspaceEventEnvelope
from shared.services import realtime_topics
from shared.services.realtime_publisher import publish_envelope_to_redis
from src.core.config import config

__all__ = ("PICKUP_MIX_UPDATED", "emit_pickup_mix_updated")

PICKUP_MIX_UPDATED = "pickup_mix.updated"

_redis_client: Redis | None = None


def _get_redis() -> Redis:
    global _redis_client
    if _redis_client is None:
        _redis_client = Redis.from_url(config.redis_url, decode_responses=True)
    return _redis_client


async def emit_pickup_mix_updated(workspace_id: int, *, reason: str, actor_user_id: int | None = None) -> None:
    """Best-effort publish, called after the caller's mutation has committed.

    ``reason`` (``roster``/``rank``/``member``) is diagnostic only -- every
    consumer refetches the same two query families regardless of which one
    fired.
    """
    envelope = WorkspaceEventEnvelope(
        event_id=0,  # non-durable: no replay cursor, clients refetch on subscribe
        event_type=PICKUP_MIX_UPDATED,
        schema_version=1,
        occurred_at=datetime.now(UTC),
        actor_user_id=actor_user_id,
        data={"workspace_id": int(workspace_id), "reason": reason},
    )
    try:
        await publish_envelope_to_redis(_get_redis(), topic=realtime_topics.pickup_mix(workspace_id), envelope=envelope)
    except Exception:  # pragma: no cover - best-effort signal
        logger.exception(f"Failed to publish pickup_mix.updated for workspace {workspace_id}")
