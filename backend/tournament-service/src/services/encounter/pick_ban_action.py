"""Generic pick-ban action engine: generalizes ``map_veto.py``'s
``apply_veto_action``/``perform_veto_action``/``build_map_pool_state`` to run
over a :class:`~shared.models.tournament.pick_ban.PickBanSession`, any
``kind``, with the two rule additions neither rulebook could skip:
``protect`` as a third action alongside ban/pick, and an optional
role/attribute-uniqueness check within one side's actions in the active round.

Design: docs/plans/2026-08-09-generic-pickban-engine.md §5.3-§5.4.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
import random
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from shared.core import http_status as status
from shared.core.enums import MapPickSide, MapPoolEntryStatus, MapVetoSessionStatus, PickBanKind
from shared.core.errors import BaseAPIException as HTTPException
from shared.models.catalog.hero import Hero
from shared.models.tournament.encounter import Encounter
from shared.models.tournament.pick_ban import EncounterPickBanLedger, PickBanConfig, PickBanEntry, PickBanSession
from shared.services import pick_ban_engine as engine
from src.services.encounter import pick_ban_session as pick_ban_session_service
from src.services.encounter.realtime_commit import register_map_veto_realtime_update


async def _load_pool(session: AsyncSession, pick_ban_id: int) -> list[PickBanEntry]:
    result = await session.execute(
        select(PickBanEntry).where(PickBanEntry.session_id == pick_ban_id).order_by(PickBanEntry.order)
    )
    return list(result.scalars().all())


async def get_pick_ban_pool(
    session: AsyncSession, pick_ban: PickBanSession, encounter_id: int, kind: PickBanKind
) -> list[PickBanEntry]:
    """Load the pool, resolving any pending timeout/decider step first —
    mirrors ``map_veto.get_map_pool``'s side effect so every state read
    self-heals a stalled turn the same way ``perform_pick_ban_action`` does
    after an action. Timeout resolution runs first: the random pick it
    applies can itself leave a decider current, which the following call
    then resolves in the same read."""
    pool = await _load_pool(session, pick_ban.id)
    await auto_resolve_timeout(session, encounter_id, kind, pick_ban=pick_ban, pool=pool)
    await auto_complete_decider(session, encounter_id, kind, pick_ban=pick_ban, pool=pool)
    return pool


def auto_complete_decider_entry(sequence: list[str], pool: list[PickBanEntry]) -> PickBanEntry | None:
    """Generalizes ``map_veto.auto_complete_decider_entry``: ``slot``/
    ``current_slot`` -> ``round``/``current_round``, ``map_id`` -> ``item_id``.
    Returns ``None`` when there is no pending decider step to resolve; raises
    if a decider step is current but the round does not hold exactly one
    available candidate (a config/data invariant violation, not a normal
    state)."""
    step = engine.get_current_step(sequence, pool)
    if step is None:
        return None

    _, step_action = step
    if step_action != "decider":
        return None

    active_round = engine.current_round(pool)
    available = [
        entry
        for entry in pool
        if entry.status == MapPoolEntryStatus.AVAILABLE.value and engine.in_current_round(entry, active_round)
    ]
    if len(available) != 1:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Decider step requires exactly one available item",
        )

    entry = available[0]
    entry.action_index = sum(1 for pool_entry in pool if pool_entry.status != MapPoolEntryStatus.AVAILABLE.value)
    entry.status = MapPoolEntryStatus.PICKED.value
    entry.picked_by = MapPickSide.DECIDER.value
    # The PICKED assignment above must precede this count (mirrors
    # map_veto.py's own ordering comment): counting includes this entry, so
    # ``order`` comes out 1-based.
    entry.order = sum(1 for pool_entry in pool if pool_entry.status == MapPoolEntryStatus.PICKED.value)
    return entry


async def auto_complete_decider(
    session: AsyncSession,
    encounter_id: int,
    kind: PickBanKind,
    *,
    pick_ban: PickBanSession | None = None,
    pool: list[PickBanEntry] | None = None,
) -> PickBanEntry | None:
    """Resolve a pending decider step from the session snapshot, if any.
    Generalizes ``map_veto.auto_complete_decider``."""
    if pick_ban is None:
        pick_ban = await pick_ban_session_service.get_pick_ban_session(session, encounter_id, kind)
    if pick_ban is None or pick_ban.status != MapVetoSessionStatus.ACTIVE.value:
        return None

    if pool is None:
        pool = await _load_pool(session, pick_ban.id)

    entry = auto_complete_decider_entry(pick_ban.resolved_sequence_json, pool)
    if entry is None:
        return None

    pick_ban.current_step_started_at = datetime.now(UTC)
    if engine.get_current_step(pick_ban.resolved_sequence_json, pool) is None:
        pick_ban.status = MapVetoSessionStatus.COMPLETED.value

    register_map_veto_realtime_update(session, encounter_id, kind=kind.value)
    await session.commit()
    await session.refresh(entry)
    return entry


async def auto_resolve_timeout(
    session: AsyncSession,
    encounter_id: int,
    kind: PickBanKind,
    *,
    pick_ban: PickBanSession | None = None,
    pool: list[PickBanEntry] | None = None,
) -> PickBanEntry | None:
    """Auto-resolve a captain step (ban/pick/protect) whose turn timer has
    elapsed, standing in for a captain who never acted: picks uniformly at
    random among every candidate that action would legally accept right now
    (same eligibility ``apply_pick_ban_action`` enforces, attribute
    uniqueness included) and applies it as if that side had chosen it.

    Lazy and read-triggered, like ``auto_complete_decider`` — there is no
    background scheduler, so a timed-out step only resolves the next time
    someone reads this session's state or acts on it. A session with
    ``turn_timer_seconds=None`` (no timer configured) or a fresh step
    (``current_step_started_at=None``) never times out. A ``decider`` step
    has no captain and is out of scope here; it already auto-resolves via
    ``auto_complete_decider``, called right after this in
    ``get_pick_ban_pool``/``perform_pick_ban_action``."""
    if pick_ban is None:
        pick_ban = await pick_ban_session_service.get_pick_ban_session(session, encounter_id, kind)
    if pick_ban is None or pick_ban.status != MapVetoSessionStatus.ACTIVE.value:
        return None
    if pick_ban.turn_timer_seconds is None or pick_ban.current_step_started_at is None:
        return None

    now = datetime.now(UTC)
    deadline = pick_ban.current_step_started_at + timedelta(seconds=pick_ban.turn_timer_seconds)
    if now < deadline:
        return None

    if pool is None:
        pool = await _load_pool(session, pick_ban.id)

    step = engine.get_current_step(pick_ban.resolved_sequence_json, pool)
    if step is None:
        return None
    _, step_token = step
    parsed = engine.parse_step_token(step_token)
    if parsed.side is None:  # "decider" — no captain to time out
        return None

    active_round = engine.current_round(pool)
    config = await session.get(PickBanConfig, pick_ban.config_id) if pick_ban.config_id else None
    unique_attribute = config.unique_attribute_per_side_per_round if config is not None else None
    attribute_lookup = (
        await _attribute_lookup(session, kind, [e.item_id for e in pool]) if unique_attribute is not None else {}
    )
    committed = [
        (e.picked_by or e.protected_by, e.round, attribute_lookup.get(e.item_id))
        for e in pool
        if e.status in (MapPoolEntryStatus.BANNED.value, MapPoolEntryStatus.PROTECTED.value)
    ]

    def eligible(entry: PickBanEntry) -> bool:
        if not engine.in_current_round(entry, active_round):
            return False
        if parsed.action == "ban":
            if not engine.is_entry_bannable(entry, active_round=active_round):
                return False
        elif entry.status != MapPoolEntryStatus.AVAILABLE.value:
            return False
        if (
            parsed.action in ("ban", "protect")
            and unique_attribute is not None
            and engine.violates_unique_attribute(
                candidate_attribute=attribute_lookup.get(entry.item_id),
                acting_side=parsed.side,
                round_number=active_round,
                committed_this_round=committed,
            )
        ):
            return False
        return True

    candidates = [entry for entry in pool if eligible(entry)]
    if not candidates:
        # No legal candidate for this side right now — a config/data
        # invariant violation elsewhere (mirrors auto_complete_decider_entry's
        # own floor check), not something a random pick can paper over. Leave
        # the step as-is; it surfaces the same way it already would.
        return None

    chosen = random.choice(candidates)
    entry = apply_pick_ban_action(
        pick_ban,
        pool,
        captain_side=parsed.side,
        item_id=chosen.item_id,
        action=parsed.action,
        attribute_lookup=attribute_lookup,
        unique_attribute=unique_attribute,
        now=now,
    )
    if parsed.action in ("ban", "protect") and config is not None and config.no_repeat_scope != "none":
        session.add(
            EncounterPickBanLedger(
                encounter_id=encounter_id,
                kind=kind,
                item_id=chosen.item_id,
                banned_by_side=parsed.side,
                round=entry.round or 0,
            )
        )

    register_map_veto_realtime_update(session, encounter_id, kind=kind.value)
    await session.commit()
    await session.refresh(entry)
    await auto_complete_decider(session, encounter_id, kind, pick_ban=pick_ban, pool=pool)
    return entry


async def _attribute_lookup(session: AsyncSession, kind: PickBanKind, item_ids: list[int]) -> dict[int, Any]:
    """``{item_id: attribute_value}`` for the configured
    ``unique_attribute_per_side_per_round`` (only ``"role"`` today, resolved
    against the hero catalog — a ``kind=map`` config never sets this option,
    so this is never called with `kind=map`)."""
    if kind != PickBanKind.HERO or not item_ids:
        return {}
    result = await session.execute(select(Hero.id, Hero.type).where(Hero.id.in_(item_ids)))
    return {row[0]: row[1].value for row in result.all()}


def serialize_pick_ban_entry(entry: PickBanEntry) -> dict[str, Any]:
    return {
        "id": entry.id,
        "item_id": entry.item_id,
        "round": entry.round,
        "order": entry.order,
        "action_index": entry.action_index,
        "picked_by": entry.picked_by,
        "protected_by": entry.protected_by,
        "status": entry.status,
        "team_id": entry.team_id,
    }


def serialize_pick_ban_session(pick_ban: PickBanSession) -> dict[str, Any]:
    return {
        "id": pick_ban.id,
        "kind": pick_ban.kind,
        "status": pick_ban.status,
        "first_side": pick_ban.first_side,
        "awaiting_choice": pick_ban.awaiting_choice,
        "pending_loser_side": pick_ban.pending_loser_side,
        "seed_source": pick_ban.seed_source,
        "home_seed": pick_ban.home_seed,
        "away_seed": pick_ban.away_seed,
        "turn_timer_seconds": pick_ban.turn_timer_seconds,
        # Passthrough of the session's reserve snapshot, string-keyed by slot
        # position, gaps and reserve-less slots omitted -- see
        # pick_ban_session.ensure_pick_ban_session's slot_reserves comment.
        # Always None for kind=hero (no reserve concept there); read by
        # `PickBanGrid`'s reserve caption via `pickBanReserveMap` for kind=map.
        "slot_reserves": pick_ban.slot_reserves_json,
        "started_at": pick_ban.started_at.isoformat() if pick_ban.started_at else None,
        "current_step_started_at": (
            pick_ban.current_step_started_at.isoformat() if pick_ban.current_step_started_at else None
        ),
    }


def build_unavailable_state(reason: str, *, readiness: dict[str, bool]) -> dict[str, Any]:
    return {
        "session": None,
        "reason": reason,
        "readiness": readiness,
        "sequence": [],
        "pool": [],
        "viewer_side": None,
        "viewer_can_act": False,
        "allowed_actions": [],
        "current_step_index": None,
        "current_step": None,
        "expected_action": None,
        "turn_side": None,
        "current_round": None,
        "is_complete": False,
    }


def build_pick_ban_state(
    sequence: list[str],
    pool: list[PickBanEntry],
    *,
    viewer_side: str | None,
    pick_ban: PickBanSession | None,
    readiness: dict[str, bool],
) -> dict[str, Any]:
    """Pure state builder — same shape as ``map_veto.build_map_pool_state``,
    generalized to pool-agnostic ``pick_ban`` sessions with `protect` steps."""
    current_step = engine.get_current_step(sequence, pool)
    current_step_value: str | None = None
    expected_action: str | None = None
    turn_side: str | None = None
    allowed_actions: list[str] = []

    if current_step is not None:
        _, current_step_value = current_step
        if current_step_value == "decider":
            expected_action = "decider"
        else:
            parsed = engine.parse_step_token(current_step_value)
            expected_action = parsed.action
            turn_side = parsed.side

        if viewer_side is not None and turn_side == viewer_side and expected_action in {"pick", "ban", "protect"}:
            allowed_actions = [expected_action]

    return {
        "session": serialize_pick_ban_session(pick_ban) if pick_ban is not None else None,
        "readiness": readiness,
        "sequence": list(sequence),
        "pool": [serialize_pick_ban_entry(entry) for entry in pool],
        "viewer_side": viewer_side,
        "viewer_can_act": bool(allowed_actions),
        "allowed_actions": allowed_actions,
        "current_step_index": current_step[0] if current_step is not None else None,
        "current_step": current_step_value,
        "expected_action": expected_action,
        "turn_side": turn_side,
        "current_round": engine.current_round(pool),
        "is_complete": current_step is None,
    }


async def get_pick_ban_state(
    session: AsyncSession,
    encounter_id: int,
    kind: PickBanKind,
    *,
    viewer_side: str | None = None,
) -> dict[str, Any]:
    enc_result = await session.execute(select(Encounter).where(Encounter.id == encounter_id))
    encounter = enc_result.scalar_one_or_none()
    if encounter is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Encounter not found")

    readiness = await pick_ban_session_service.get_readiness(session, encounter_id)
    pick_ban = await pick_ban_session_service.ensure_pick_ban_session(session, encounter, kind)
    if pick_ban is None:
        # Mirrors veto_session.unavailable_reason's contract: names WHY, never
        # a bare 400 -- see pick_ban_session.unavailable_reason for why this
        # re-derives against PickBanConfig instead of being handed the cause.
        reason = await pick_ban_session_service.unavailable_reason(session, encounter, kind)
        return build_unavailable_state(reason, readiness=readiness)

    pool = await get_pick_ban_pool(session, pick_ban, encounter_id, kind)
    return build_pick_ban_state(
        pick_ban.resolved_sequence_json, pool, viewer_side=viewer_side, pick_ban=pick_ban, readiness=readiness
    )


def apply_pick_ban_action(
    pick_ban: PickBanSession,
    pool: list[PickBanEntry],
    *,
    captain_side: str,
    item_id: int,
    action: str,
    attribute_lookup: dict[int, Any],
    unique_attribute: str | None,
    now: datetime,
) -> PickBanEntry:
    """Pure step: validate and apply one ban/pick/protect. Generalizes
    ``map_veto.apply_veto_action`` with the `protect` action and the optional
    role/attribute-uniqueness check."""
    step = engine.get_current_step(pick_ban.resolved_sequence_json, pool)
    if step is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Pick-ban sequence is already complete")

    _, step_token = step
    parsed = engine.parse_step_token(step_token)
    if action != parsed.action:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=f"Expected action '{parsed.action}', got '{action}'"
        )
    if parsed.side and captain_side != parsed.side:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=f"It's {parsed.side} team's turn, not {captain_side}"
        )

    active_round = engine.current_round(pool)
    entry = next(
        (e for e in pool if e.item_id == item_id and engine.in_current_round(e, active_round)),
        None,
    )
    if entry is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Item is not a candidate this round")
    if action == "ban" and not engine.is_entry_bannable(entry, active_round=active_round):
        reason = "protected" if entry.protected_by is not None else entry.status
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Item is {reason}")
    if action in ("pick", "protect") and entry.status != MapPoolEntryStatus.AVAILABLE.value:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Item is already {entry.status}")

    if action in ("ban", "protect") and unique_attribute is not None:
        committed = [
            (e.picked_by or e.protected_by, e.round, attribute_lookup.get(e.item_id))
            for e in pool
            if e.status in (MapPoolEntryStatus.BANNED.value, MapPoolEntryStatus.PROTECTED.value)
        ]
        if engine.violates_unique_attribute(
            candidate_attribute=attribute_lookup.get(item_id),
            acting_side=captain_side,
            round_number=active_round,
            committed_this_round=committed,
        ):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Your side already banned/protected an item with this attribute this round",
            )

    entry.action_index = sum(1 for e in pool if e.status != MapPoolEntryStatus.AVAILABLE.value)
    if action == "ban":
        entry.status = MapPoolEntryStatus.BANNED.value
        entry.picked_by = captain_side
    elif action == "protect":
        entry.status = MapPoolEntryStatus.PROTECTED.value
        entry.protected_by = captain_side
    elif action == "pick":
        entry.status = MapPoolEntryStatus.PICKED.value
        entry.picked_by = captain_side
        entry.order = sum(1 for e in pool if e.status == MapPoolEntryStatus.PICKED.value)

    pick_ban.current_step_started_at = now
    if engine.get_current_step(pick_ban.resolved_sequence_json, pool) is None:
        pick_ban.status = MapVetoSessionStatus.COMPLETED.value
    return entry


async def perform_pick_ban_action(
    session: AsyncSession,
    encounter_id: int,
    kind: PickBanKind,
    captain_side: str,
    item_id: int,
    action: str,
) -> PickBanEntry:
    pick_ban = await pick_ban_session_service.get_pick_ban_session(session, encounter_id, kind)
    if pick_ban is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Pick-ban session is not initialized")
    if pick_ban.status != MapVetoSessionStatus.ACTIVE.value:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Pick-ban session is {pick_ban.status}")

    pool = await _load_pool(session, pick_ban.id)
    config = await session.get(PickBanConfig, pick_ban.config_id) if pick_ban.config_id else None
    attribute_lookup = (
        await _attribute_lookup(session, kind, [e.item_id for e in pool])
        if config is not None and config.unique_attribute_per_side_per_round
        else {}
    )

    entry = apply_pick_ban_action(
        pick_ban,
        pool,
        captain_side=captain_side,
        item_id=item_id,
        action=action,
        attribute_lookup=attribute_lookup,
        unique_attribute=config.unique_attribute_per_side_per_round if config else None,
        now=datetime.now(UTC),
    )

    if action in ("ban", "protect") and config is not None and config.no_repeat_scope != "none":
        session.add(
            EncounterPickBanLedger(
                encounter_id=encounter_id,
                kind=kind,
                item_id=item_id,
                banned_by_side=captain_side,
                round=entry.round or 0,
            )
        )

    register_map_veto_realtime_update(session, encounter_id, kind=kind.value)
    await session.commit()
    await session.refresh(entry)
    # Resolve a decider step that becomes current as a DIRECT RESULT of this
    # action (e.g. the last ban of a Bo1 round leaving exactly one item)
    # without a second client round-trip. Mirrors map_veto.perform_veto_action.
    await auto_complete_decider(session, encounter_id, kind, pick_ban=pick_ban, pool=pool)
    return entry
