"""Realtime signals for encounter map-veto / hero pick-ban rooms.

Both are DATA events: ``encounter:{id}:map-veto`` (kind="map") and
``encounter:{id}:pick-ban:hero`` (kind="hero"). Two topics, not one
parametrized by kind, so the map room's subscribers are never woken by a
hero-only change and vice versa.

The payload carries no state at all: subscribers refetch the pool on receipt
(``viewer_side`` and friends are per-viewer, so there is nothing broadcastable
to fold in). What changed is already said by the topic and the event type.

Nothing here invalidates a tournament cache: a pick-ban write touches only
pick-ban tables. The one encounter write that does move a tournament-scoped
read is a map report resolving a map (``map_report.py``), and it names that
resource itself. A MIX match's hero room is the exception: its mix's overview
shows the match in Pre-game until the room completes or is cancelled (spec §5),
so that transition also stales the workspace's ``workspace.pickup_mix`` -- the
same signal balancer-service's ``emit_pickup_mix_changed`` sends web clients.

Staging/persistence/publishing all live in ``shared.services.realtime.emit``:
call this immediately before the commit that owns the pool mutation.

It also stages that room's RECONCILE (``room_reconcile``). Every write that
moves a room already signals it here, so this one call site covers captain
actions, undo, readiness, resets, map reports, corrections and the organizer's
controls -- and the reconcile is what heals the room, since the state read is
pure. The reconcile's own signal re-enters here once; a pass
that changes nothing emits nothing, so it converges.
"""

from __future__ import annotations

from typing import Any

from sqlalchemy import select

from shared.core.enums import MapVetoSessionStatus, PickBanKind
from shared.models.encounter.encounter import Encounter
from shared.models.encounter.pick_ban import PickBanSession
from shared.services.realtime import DomainEvent, Resource, Scope, emit
from src.services.encounter.room_reconcile import request_room_reconcile

__all__ = ("emit_pick_ban_update",)

_DOMAIN_BY_KIND = {"map": "map-veto", "hero": "pick-ban:hero"}
_EVENT_TYPE_BY_KIND = {"map": "map_veto.updated", "hero": "pick_ban.updated"}


async def emit_pick_ban_update(session: Any, encounter_id: int, *, kind: str = "map") -> None:
    """Stage a pick-ban room signal for ``encounter_id`` + ``kind``.

    ``kind`` is ``"map"`` (default) or ``"hero"``.
    """
    await emit(
        session,
        scope=Scope.encounter(int(encounter_id)),
        data=DomainEvent(
            domain=_DOMAIN_BY_KIND.get(kind, "pick-ban:hero"),
            event_type=_EVENT_TYPE_BY_KIND.get(kind, "pick_ban.updated"),
            payload={"encounter_id": int(encounter_id)},
        ),
    )
    request_room_reconcile(session, encounter_id)
    if kind == PickBanKind.HERO.value:
        await _announce_settled_mix_room(session, encounter_id)


async def _announce_settled_mix_room(session: Any, encounter_id: int) -> None:
    """Tell a mix's overview its match left Pre-game: the hero room completed or was cancelled."""
    encounter = await session.get(Encounter, encounter_id)
    if encounter is None or encounter.custom_game_id is None:
        return
    status = await session.scalar(
        select(PickBanSession.status).where(
            PickBanSession.encounter_id == encounter_id, PickBanSession.kind == PickBanKind.HERO
        )
    )
    if status not in (MapVetoSessionStatus.COMPLETED, MapVetoSessionStatus.CANCELLED):
        return
    await emit(
        session,
        scope=Scope.workspace(int(encounter.workspace_id)),
        invalidates=[Resource.WORKSPACE_PICKUP_MIX],
        data=DomainEvent(
            domain="pickup_mix",
            event_type="pickup_mix.updated",
            payload={"workspace_id": int(encounter.workspace_id), "change": "pick_ban"},
            durable=False,
        ),
    )
