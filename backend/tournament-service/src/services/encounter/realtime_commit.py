"""After-commit realtime publishing for encounter map-veto / hero-ban updates.

Encounter-scoped sibling of ``src/services/tournament/realtime_commit.py``.
Where the tournament module fans bracket/results/structure changes out to the
``tournament:{id}:bracket`` topic, this module emits a thin ``updated`` signal
per pick-ban ``kind`` — ``encounter:{id}:map-veto`` (unchanged, kind="map") or
``encounter:{id}:pick-ban:hero`` (kind="hero"). The payload carries no
per-viewer state (``viewer_side`` is presentation-only): subscribers refetch
the relevant pool state on receipt. Two separate topics, not one parametrized
by kind, so the legacy map-veto room's subscribers are never woken by a
hero-only change and vice versa (design: docs/plans/2026-08-09-generic-pickban-engine.md).

Staging is delegated to the shared transactional factory
(``shared.services.realtime_transaction.register_realtime_update``):
1. A write path calls ``register_map_veto_realtime_update(session, encounter_id, kind=...)``
   immediately before its commit.
2. The factory's ``before_flush`` listener persists a ``WorkspaceEvent`` row for
   durability.
3. The factory's ``after_commit`` listener publishes the persisted event's
   envelope to Redis, from which the gateway events consumer relays it to WS
   subscribers.
"""

from __future__ import annotations

from typing import Any

from sqlalchemy import event
from sqlalchemy.orm import Session

from shared.models.platform.realtime import WorkspaceEvent
from shared.services import realtime_topics
from shared.services.realtime_transaction import register_realtime_update
from src.core import config

_MAP_VETO_REASON = "veto_changed"
_EVENT_TYPE_BY_KIND = {"map": "map_veto.updated", "hero": "pick_ban.updated"}

# Distinct from the tournament module's key so raw staging never collides.
# Kept for `pop_registered_map_veto_realtime_updates`'s existing callers (test
# introspection -- see test_pregame_loop.py) rather than for a listener of this
# module's own anymore -- persistence/publishing now live in the shared factory.
_SESSION_KEY = "encounter_map_veto_realtime_updates"


def register_map_veto_realtime_update(session: Any, encounter_id: int, *, kind: str = "map") -> None:
    """Stage a pick-ban realtime signal for the given encounter+kind on this
    session. ``kind`` is ``"map"`` (default, the legacy map-veto topic) or
    ``"hero"`` (the generic hero-ban topic).

    Call immediately before the commit that mutated the pool. The staged pair
    is turned into a persisted ``WorkspaceEvent`` row on ``before_flush`` and
    published to Redis on ``after_commit`` by the shared realtime-staging
    factory (`shared.services.realtime_transaction.register_realtime_update`).
    """
    sync_session = getattr(session, "sync_session", None)
    info = getattr(sync_session or session, "info", None)
    if info is None:
        return

    updates: set[tuple[int, str]] = info.setdefault(_SESSION_KEY, set())
    updates.add((int(encounter_id), kind))

    register_realtime_update(
        session,
        key=(int(encounter_id), kind),
        build_event=lambda: _build_realtime_event(int(encounter_id), kind),
        redis_url=str(config.settings.redis_url),
    )


def pop_registered_map_veto_realtime_updates(session: Any) -> list[tuple[int, str]]:
    sync_session = getattr(session, "sync_session", None)
    info = getattr(sync_session or session, "info", None)
    if info is None:
        return []

    updates: set[tuple[int, str]] = info.pop(_SESSION_KEY, set())
    return sorted(updates)


def _build_realtime_event(encounter_id: int, kind: str) -> WorkspaceEvent:
    topic = realtime_topics.map_veto(encounter_id) if kind == "map" else realtime_topics.pick_ban_hero(encounter_id)
    return WorkspaceEvent(
        topic=topic,
        event_type=_EVENT_TYPE_BY_KIND.get(kind, "pick_ban.updated"),
        schema_version=1,
        payload={
            "encounter_id": int(encounter_id),
            "reason": _MAP_VETO_REASON,
        },
    )


@event.listens_for(Session, "after_rollback")
def _clear_registered_map_veto_updates_after_rollback(session: Session) -> None:
    # The shared factory clears its OWN staged builders on rollback; this
    # module's raw (encounter_id, kind) accumulation is a distinct piece of
    # session state it knows nothing about, so it still needs its own cleanup —
    # otherwise a session reused for a later transaction after a rollback would
    # carry a stale pair into that transaction's `pop_registered_...` callers.
    pop_registered_map_veto_realtime_updates(session)
