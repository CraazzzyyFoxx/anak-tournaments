from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Any

from loguru import logger
from pydantic import BaseModel
from sqlalchemy import or_, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from shared.models.platform.outbox import EventOutbox
from shared.observability.worker import observe_scheduled_job
from shared.services.stats_evidence import capture_stats_evidence, owner_scopes, stage_stats_evidence

PENDING_STATUSES = ("pending", "failed")


async def drain_outbox(session_factory: Any, broker: Any, *, limit: int = 100) -> None:
    """One scheduler tick of the outbox relay, run by every service that writes outbox rows.

    Schedule it every second (``scheduler.add_job(drain_outbox, "interval", seconds=1, args=(factory, broker))``
    or ``IntervalScheduler.start(drain_outbox, seconds=1, args=(...))``). Concurrent drains across services and
    replicas are safe: the batch is taken ``FOR UPDATE SKIP LOCKED``, so no row is published by two of them.
    """
    async with observe_scheduled_job("event_outbox_drain"), session_factory() as session:
        published = await publish_pending_outbox_events(session, broker, limit=limit, commit=True)
        if published:
            logger.info("Published {} outbox events", published)


def _name(value: Any) -> str | None:
    if value is None:
        return None
    return str(getattr(value, "name", value))


def _event_payload(event: BaseModel | dict[str, Any]) -> dict[str, Any]:
    if isinstance(event, BaseModel):
        return event.model_dump(mode="json")
    return dict(event)


async def enqueue_outbox_event(
    session: AsyncSession,
    event: BaseModel | dict[str, Any],
    *,
    exchange: Any,
    routing_key: str,
    event_id: str | None = None,
    event_type: str | None = None,
) -> EventOutbox:
    payload = _event_payload(event)
    resolved_event_id = str(event_id or payload.get("event_id") or "")
    if not resolved_event_id:
        raise ValueError("Outbox events require payload.event_id")

    row = EventOutbox(
        event_id=resolved_event_id,
        event_type=str(event_type or payload.get("event_type") or event.__class__.__name__),
        exchange=_name(exchange),
        routing_key=routing_key,
        payload_json=payload,
        status="pending",
        attempts=0,
    )
    before = None
    if "changed_tables" in payload:
        row.id = await session.scalar(text("SELECT nextval(pg_get_serial_sequence('event_outbox', 'id'))"))
        scopes = owner_scopes("outbox", (row.id,))
        before = await capture_stats_evidence(session, scopes=scopes)
    session.add(row)
    await session.flush()
    if before is not None:
        after = await capture_stats_evidence(session, scopes=scopes)
        await stage_stats_evidence(
            session,
            operation="stats.reference_update",
            before=before,
            after=after,
            workspace_id=payload.get("workspace_id"),
            entity_type="event_outbox",
            entity_id=row.id,
        )
    return row


async def publish_pending_outbox_events(
    session: AsyncSession,
    broker: Any,
    *,
    limit: int = 100,
    now: datetime | None = None,
    commit: bool = True,
) -> int:
    now = now or datetime.now(UTC)
    due = (
        select(EventOutbox)
        .where(
            EventOutbox.status.in_(PENDING_STATUSES),
            or_(
                EventOutbox.next_attempt_at.is_(None),
                EventOutbox.next_attempt_at <= now,
            ),
        )
        .order_by(EventOutbox.created_at.asc(), EventOutbox.id.asc())
        .limit(limit)
        .with_for_update(skip_locked=True)
    )

    # One locked batch, one commit at the end of it. The batch must stay locked
    # for as long as this drain is publishing it: every replica of every
    # producing service runs this each second, and a row released early is free
    # for another drain to take and publish a second time (duplicate Discord
    # DMs). That is what rules out a commit per row — which also cost a
    # transaction, a ``SET LOCAL statement_timeout`` and a separate locking
    # SELECT per event (Sentry OWT-TOURNAMENTS-2BT). Delivery stays
    # at-least-once: a crash between a publish and the commit replays the whole
    # batch. No consumer dedupes on ``x-event-id``; every consumer is
    # idempotent through its own state instead (a job row's status, a
    # ``discord_message`` row, a cache key that is simply dropped again, a
    # version fence) — a new consumer must be too.
    rows = list(await session.scalars(due))
    if not rows:
        return 0

    published = 0
    for row in rows:
        try:
            await broker.publish(
                row.payload_json,
                "",
                row.exchange,
                routing_key=row.routing_key,
                message_id=row.event_id,
                headers={"x-event-id": row.event_id},
                persist=True,
            )
        except Exception as exc:
            row.status = "failed"
            row.attempts += 1
            row.last_error = str(exc)
            row.next_attempt_at = now + _retry_delay(row.attempts)
            logger.warning(
                f"Outbox publish failed for event {row.event_id} (type={row.event_type}, attempt={row.attempts}): {exc}"
            )
        else:
            row.status = "published"
            row.published_at = now
            row.last_error = None
            published += 1

    await session.flush()
    if commit:
        await session.commit()

    return published


def _retry_delay(attempts: int) -> timedelta:
    return timedelta(seconds=min(2 ** max(attempts - 1, 0), 300))
