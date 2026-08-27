"""Shared transactional realtime-event staging: dedupe-then-publish over the
SQLAlchemy session lifecycle (before_flush persists, after_commit publishes).

Generalizes the near-identical pattern in
`tournament-service/src/services/tournament/realtime_commit.py` and
`tournament-service/src/services/encounter/realtime_commit.py` — see
docs/plans/2026-08-24-realtime-shared-library.md §4.2.
"""

from __future__ import annotations

import asyncio
from collections.abc import Callable, Sequence
from datetime import UTC, datetime
from typing import Any

from loguru import logger
from sqlalchemy import event
from sqlalchemy.orm import Session

from shared.models.platform.realtime import WorkspaceEvent
from shared.schemas.realtime import WorkspaceEventEnvelope
from shared.services.realtime_publisher import event_to_envelope, publish_event_to_redis_url

__all__ = ("register_realtime_update",)

_SESSION_KEY = "shared_realtime_staged_updates"
_SESSION_EVENTS_KEY = "shared_realtime_staged_event_objects"

# What `build_event` may hand back: one row, several (a caller collapsing
# multiple registrations into one key may still need more than one persisted
# row per flush — see `tournament/realtime_commit.py`'s bracket/registration
# split), or nothing (used to CANCEL a previously-registered builder under the
# same key once its condition no longer holds, since dedup is last-write-wins).
BuiltEvent = WorkspaceEvent | Sequence[WorkspaceEvent] | None

# asyncio holds only a WEAK reference to a running task, so a fire-and-forget
# `create_task` whose result nobody keeps can be collected mid-flight and take
# the Redis publish with it, silently. Anchoring the handles here until they
# finish is the documented remedy (same as both modules being generalized).
_background_tasks: set[asyncio.Task[Any]] = set()


def _spawn(loop: asyncio.AbstractEventLoop, coro: Any) -> None:
    task = loop.create_task(coro)
    _background_tasks.add(task)
    task.add_done_callback(_background_tasks.discard)


def register_realtime_update(
    session: Any,
    *,
    key: tuple[Any, ...],
    build_event: Callable[[], BuiltEvent],
    redis_url: str,
) -> None:
    """Stage a realtime update, deduped by `key` within this transaction.

    `build_event` is called lazily, at `before_flush` time (not here) — the
    caller may still be mutating rows this event's own fields will read. If
    `build_event`'s payload must reflect a snapshot, that snapshot is fetched
    by the CALLER, synchronously, before this function is invoked (`await`
    happens in the caller's own async request-handling code, never inside a
    SQLAlchemy sync listener). `build_event` returns a single `WorkspaceEvent`,
    a sequence of them, or `None` (stage nothing this flush).

    Repeat calls with the same `key` in one transaction overwrite the staged
    builder — the last one registered wins, matching both modules' existing
    dedup behavior. A caller that needs to merge several registrations for the
    same key into one decision (e.g. "strongest reason wins") re-derives that
    decision itself on every call and re-registers a fresh closure reflecting
    it — the factory only ever sees, and only ever fires, the LAST one.

    `redis_url` is the target Redis instance for the eventual publish — passed
    explicitly (not read from a service's own settings) because this module is
    shared across services and has no `src.core.config` of its own.
    """
    sync_session = getattr(session, "sync_session", None)
    info = getattr(sync_session or session, "info", None)
    if info is None:
        return
    builders: dict[tuple[Any, ...], tuple[Callable[[], BuiltEvent], str]] = info.setdefault(_SESSION_KEY, {})
    builders[key] = (build_event, redis_url)


def _pop_registered_updates(session: Any) -> dict[tuple[Any, ...], tuple[Callable[[], BuiltEvent], str]]:
    sync_session = getattr(session, "sync_session", None)
    info = getattr(sync_session or session, "info", None)
    if info is None:
        return {}
    return info.pop(_SESSION_KEY, {})


def _normalize_built(result: BuiltEvent) -> list[WorkspaceEvent]:
    if result is None:
        return []
    if isinstance(result, WorkspaceEvent):
        return [result]
    return list(result)


@event.listens_for(Session, "before_flush")
def _stage_before_flush(session: Session, _flush_context: Any, _instances: Any) -> None:
    builders = _pop_registered_updates(session)
    if not builders:
        return

    pending: list[tuple[WorkspaceEvent, str]] = [
        (built, redis_url) for build, redis_url in builders.values() for built in _normalize_built(build())
    ]
    if not pending:
        return

    session.add_all(event_obj for event_obj, _redis_url in pending)
    session.info.setdefault(_SESSION_EVENTS_KEY, []).extend(pending)


@event.listens_for(Session, "after_commit")
def _publish_after_commit(session: Session) -> None:
    pending: list[tuple[WorkspaceEvent, str]] = session.info.pop(_SESSION_EVENTS_KEY, [])
    if not pending:
        return

    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        logger.warning("Cannot publish realtime updates without a running event loop")
        return

    for event_obj, redis_url in pending:
        if event_obj.occurred_at is None:
            event_obj.occurred_at = datetime.now(UTC)
        envelope = event_to_envelope(event_obj)
        _spawn(loop, _publish_one(redis_url, event_obj.topic, envelope))


async def _publish_one(redis_url: str, topic: str, envelope: WorkspaceEventEnvelope) -> None:
    try:
        await publish_event_to_redis_url(redis_url, topic=topic, envelope=envelope)
    except Exception:
        logger.exception("Failed to publish persisted realtime event", topic=topic)


@event.listens_for(Session, "after_rollback")
def _clear_after_rollback(session: Session) -> None:
    _pop_registered_updates(session)
    session.info.pop(_SESSION_EVENTS_KEY, None)
