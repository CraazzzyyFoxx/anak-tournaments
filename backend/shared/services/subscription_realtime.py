"""Realtime signal for subscription-entitlement changes.

A thin ``subscription.updated`` on ``workspace:{id}:subscriptions``. It carries no
verdict and no user id -- only "something in this workspace changed, refetch". Two
reasons for that shape:

- **One publish per resolve pass, not per patron.** A sweep of 200 registrants
  that flips 40 verdicts must not fan out 40 frames to every open admin page. The
  resolver folds the whole pass into a single signal (see
  ``SubscriptionResolver.resolve``), so the cost is bounded by passes, not people.
- **Nothing to leak and nothing to replay.** The topic is workspace-member gated,
  but a signal that carries no state cannot leak who is subscribed even so, and
  the authoritative read is still permission-gated on the refetch. Non-durable
  (``event_id=0``, no ``realtime.workspace_event`` row) for the same reason as
  ``logs.updated``: a client that reconnects refetches anyway, so persisting a row
  per changed patron would buy nothing.

Both writers of entitlements publish it -- tournament-service (registration /
check-in gates, code redemption) and parser-service (the scheduled collector and
the admin re-check) -- which is why this lives in ``shared`` rather than beside
either one.

ORDERING: the resolver emits inside the transaction that wrote the entitlement,
microseconds before its caller commits. A consumer would have to complete a
WebSocket hop, its debounce, an HTTP request and an RPC round trip inside that
window to read the pre-commit row, so the signal is treated as safe rather than
buffered until after commit. The consumers debounce (see the admin page and
``TournamentHubShell``), which widens the margin by two orders of magnitude.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from loguru import logger

from shared.schemas.realtime import WorkspaceEventEnvelope
from shared.services import realtime_topics
from shared.services.realtime_publisher import publish_envelope_to_redis

__all__ = (
    "SUBSCRIPTION_UPDATED",
    "RedisSubscriptionEventSink",
    "publish_subscriptions_updated",
)

SUBSCRIPTION_UPDATED = "subscription.updated"


async def publish_subscriptions_updated(
    redis: Any | None,
    workspace_id: int | None,
    *,
    reason: str = "checked",
) -> None:
    """Best-effort publish of the thin ``subscription.updated`` signal.

    ``reason`` is the collection trigger (``scheduled``/``registration``/
    ``check_in``/``manual``/``redeem``) so an operator watching the page can tell a
    background sweep from their own re-check. It is diagnostic only -- no consumer
    branches on it.
    """
    if redis is None or not workspace_id:
        return
    envelope = WorkspaceEventEnvelope(
        event_id=0,  # non-durable signal: no replay cursor (clients refetch on subscribe)
        event_type=SUBSCRIPTION_UPDATED,
        schema_version=1,
        occurred_at=datetime.now(UTC),
        actor_user_id=None,
        data={"workspace_id": int(workspace_id), "reason": reason},
    )
    try:
        await publish_envelope_to_redis(
            redis,
            topic=realtime_topics.subscriptions(int(workspace_id)),
            envelope=envelope,
        )
    except Exception:  # pragma: no cover - best-effort signal
        logger.exception(f"Failed to publish subscription.updated for workspace {workspace_id}")


class RedisSubscriptionEventSink:
    """``SubscriptionEventSink`` over Redis pub/sub.

    A separate class rather than a bare callable so ``build_resolver`` can hand the
    resolver something that satisfies the protocol without importing Redis into the
    decision table.
    """

    def __init__(self, redis: Any) -> None:
        self._redis = redis

    async def subscriptions_updated(self, *, workspace_id: int, reason: str) -> None:
        await publish_subscriptions_updated(self._redis, workspace_id, reason=reason)
