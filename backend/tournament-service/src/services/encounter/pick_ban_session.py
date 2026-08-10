"""Pick-ban session lifecycle: generalizes ``veto_session.py``'s
``ensure_veto_session``/``reset_veto_session`` to be pool-agnostic (``kind``)
and able to grow a session's sequence round by round.

Round 1 is created exactly like today's flat/slot veto (cascade-resolved
config, seed resolution, ``effective_sequence``/``build_slot_sequence`` —
reused verbatim from ``veto_session.py``, unchanged). Round 2+ is appended
lazily by :func:`advance_to_next_round`, called once a map's result is
resolved (see ``map_report.py``): it resolves the new round's opener via
``pick_ban_engine.resolve_round_opener`` and extends
``PickBanSession.resolved_sequence_json`` + creates that round's
``PickBanEntry`` rows, filtered through the encounter's
``EncounterPickBanLedger`` per the config's ``no_repeat_scope``.

Design: docs/plans/2026-08-09-generic-pickban-engine.md
"""

from __future__ import annotations

from datetime import UTC, datetime

import sqlalchemy as sa
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from shared.core.enums import (
    FirstBanRotation,
    MapPickSide,
    MapPoolEntryStatus,
    MapVetoMode,
    MapVetoSessionStatus,
    PickBanKind,
)
from shared.core.errors import BaseAPIException as HTTPException
from shared.models.tournament.encounter import Encounter
from shared.models.tournament.pick_ban import (
    EncounterPickBanLedger,
    EncounterReadiness,
    PickBanConfig,
    PickBanConfigSlot,
    PickBanEntry,
    PickBanSession,
)
from shared.services import pick_ban_engine as engine
from src.services.encounter.realtime_commit import register_map_veto_realtime_update
from src.services.encounter.veto_session import (
    REASON_NOT_CONFIGURED,
    REASON_SLOT_COUNT_MISMATCH,
    REASON_SLOT_UNDERFILLED,
    REASON_TEAMS_UNKNOWN,
    SLOT_CANDIDATE_FLOOR,
    build_sequence_for_best_of,
    build_slot_sequence,
    effective_sequence,
    resolve_seeds,
)


async def current_round_of(session: AsyncSession, pick_ban: PickBanSession) -> int | None:
    """The round `pick_ban` is currently resolving (see
    ``pick_ban_engine.current_round``), or ``None`` in flat mode / once
    complete. Public wrapper so callers outside this module never need to load
    a session's entries themselves just to ask this."""
    result = await session.execute(select(PickBanEntry).where(PickBanEntry.session_id == pick_ban.id))
    return engine.current_round(list(result.scalars().all()))


async def highest_round_of(session: AsyncSession, pick_ban: PickBanSession) -> int | None:
    """The highest round `pick_ban` has ever created entries for, or ``None``
    in flat mode. Unlike `current_round_of` (which reports the round with
    something still `AVAILABLE`, and so goes ``None`` the instant a round
    finishes), this stays truthful right through the `awaiting_choice` gap —
    exactly the round `elect_opener` needs `advance_to_next_round` to resume
    after, when nothing is `AVAILABLE` because the next round hasn't been
    created yet."""
    result = await session.execute(select(PickBanEntry.round).where(PickBanEntry.session_id == pick_ban.id))
    rounds = [row for row in result.scalars().all() if row is not None]
    return max(rounds) if rounds else None


async def get_pick_ban_session(
    session: AsyncSession, encounter_id: int, kind: PickBanKind
) -> PickBanSession | None:
    result = await session.execute(
        select(PickBanSession).where(
            PickBanSession.encounter_id == encounter_id, PickBanSession.kind == kind
        )
    )
    return result.scalar_one_or_none()


async def _resolve_config(
    session: AsyncSession, encounter: Encounter, kind: PickBanKind
) -> PickBanConfig | None:
    """Same cascade as ``veto_session.resolve_config``, scoped by ``kind``."""
    result = await session.execute(
        select(PickBanConfig)
        .where(
            PickBanConfig.tournament_id == encounter.tournament_id,
            PickBanConfig.kind == kind,
            sa.or_(
                PickBanConfig.stage_id.is_(None),
                PickBanConfig.stage_id == encounter.stage_id,
            ),
        )
        .options(selectinload(PickBanConfig.items), selectinload(PickBanConfig.slots).selectinload(PickBanConfigSlot.items))
    )
    configs = list(result.scalars().all())
    best = None
    best_rank = -1
    for config in configs:
        if config.round is not None and config.round == encounter.round and config.stage_id == encounter.stage_id:
            rank = 2
        elif config.stage_id == encounter.stage_id and config.round is None:
            rank = 1
        elif config.stage_id is None and config.round is None:
            rank = 0
        else:
            continue
        if rank > best_rank:
            best, best_rank = config, rank
    return best


# Session-creation blocker distinct from the ``veto_session``-derived
# REASON_* set above: neither side's captain has confirmed readiness yet.
# Not a config/team problem, so checked only once those are known-good --
# see ``both_sides_ready``/``mark_ready`` below.
REASON_NOT_READY = "not_ready"


async def get_readiness(session: AsyncSession, encounter_id: int) -> dict[str, bool]:
    """``{"home": bool, "away": bool}`` -- whether each side's captain has
    confirmed readiness to begin this encounter's pre-game phase."""
    result = await session.execute(
        select(EncounterReadiness.side).where(EncounterReadiness.encounter_id == encounter_id)
    )
    ready_sides = set(result.scalars().all())
    return {"home": "home" in ready_sides, "away": "away" in ready_sides}


async def both_sides_ready(session: AsyncSession, encounter_id: int) -> bool:
    readiness = await get_readiness(session, encounter_id)
    return readiness["home"] and readiness["away"]


async def mark_ready(
    session: AsyncSession, encounter: Encounter, side: str, user_id: int | None
) -> dict[str, bool]:
    """Idempotently record ``side``'s captain confirming readiness. Returns
    the resulting ``{"home", "away"}`` readiness map."""
    existing = await session.execute(
        select(EncounterReadiness).where(
            EncounterReadiness.encounter_id == encounter.id, EncounterReadiness.side == side
        )
    )
    if existing.scalar_one_or_none() is None:
        session.add(EncounterReadiness(encounter_id=encounter.id, side=side, ready_user_id=user_id))
        await session.commit()
    return await get_readiness(session, encounter.id)


async def reset_readiness(session: AsyncSession, encounter_id: int) -> None:
    """Clear both sides' readiness -- called whenever either team assignment
    changes (a confirmation made against one opponent must not carry over to
    a different one)."""
    await session.execute(sa.delete(EncounterReadiness).where(EncounterReadiness.encounter_id == encounter_id))


async def unavailable_reason(session: AsyncSession, encounter: Encounter, kind: PickBanKind) -> str:
    """Why ``ensure_pick_ban_session`` returned ``None`` for this
    encounter/kind. Mirrors ``veto_session.unavailable_reason``'s contract
    (same REASON_* string set, re-derived rather than handed over -- see that
    function's docstring for the rationale) against ``PickBanConfig`` instead
    of the legacy ``MapVetoConfig``, and the same slot-floor check
    ``ensure_pick_ban_session`` itself applies, so the two cannot diverge."""
    if encounter.home_team_id is None or encounter.away_team_id is None:
        return REASON_TEAMS_UNKNOWN
    config = await _resolve_config(session, encounter, kind)
    if config is None:
        return REASON_NOT_CONFIGURED
    if config.mode == MapVetoMode.SLOTS:
        if not config.slots or encounter.best_of > len(config.slots):
            return REASON_SLOT_COUNT_MISMATCH
        ordered = sorted(config.slots, key=lambda s: s.position)[: encounter.best_of]
        for slot in ordered:
            if len(slot.items) < SLOT_CANDIDATE_FLOOR:
                return REASON_SLOT_UNDERFILLED
    if not await both_sides_ready(session, encounter.id):
        return REASON_NOT_READY
    return REASON_NOT_CONFIGURED


async def ensure_pick_ban_session(
    session: AsyncSession,
    encounter: Encounter,
    kind: PickBanKind,
    *,
    commit: bool = True,
) -> PickBanSession | None:
    """Idempotently create round 1 of the encounter's pick-ban session.

    Mirrors ``veto_session.ensure_veto_session`` exactly for round 1 (same
    seed resolution, same ``effective_sequence``/slot handling) — the only
    behavioral difference from today's engine is what happens AFTER round 1:
    see ``advance_to_next_round``, called from ``map_report.py`` once a map
    concludes, for rotations that cannot be precomputed.
    """
    existing = await get_pick_ban_session(session, encounter.id, kind)
    if existing is not None:
        return existing
    if encounter.home_team_id is None or encounter.away_team_id is None:
        return None
    config = await _resolve_config(session, encounter, kind)
    if config is None:
        return None

    slots: list[list[int]] | None = None
    slot_reserves: dict[str, int] | None = None
    if config.mode == MapVetoMode.SLOTS:
        if not config.slots or encounter.best_of > len(config.slots):
            return None
        ordered = sorted(config.slots, key=lambda s: s.position)[: encounter.best_of]
        for slot in ordered:
            if len(slot.items) < SLOT_CANDIDATE_FLOOR:
                return None
        slots = [[item.item_id for item in slot.items] for slot in ordered]
        # String-keyed by 1-based slot position, reserve-less slots omitted --
        # mirrors veto_session.slot_reserves exactly (Decision 18: the room
        # reads this snapshot off the session, never the config, so a later
        # config edit cannot move a running session's reserve labels).
        slot_reserves = {str(slot.position): slot.reserve_item_id for slot in ordered if slot.reserve_item_id is not None}

    if not await both_sides_ready(session, encounter.id):
        return None

    pool_size = sum(len(s) for s in slots) if slots is not None else len(config.items)
    seeds = await resolve_seeds(session, encounter)
    now = datetime.now(UTC)

    pick_ban = PickBanSession(
        encounter_id=encounter.id,
        kind=kind,
        config_id=config.id,
        first_side=seeds.first_side,
        seed_source=seeds.seed_source,
        home_seed=seeds.home_seed,
        away_seed=seeds.away_seed,
        resolved_sequence_json=engine.resolve_sequence_tokens(
            effective_sequence(config, encounter.best_of, pool_size, slots=slots)
            if config.mode == MapVetoMode.SLOTS
            else build_sequence_for_best_of(encounter.best_of, pool_size)
            if config.preset != "custom"
            else list(config.sequence_json),
            seeds.first_side,
        ),
        turn_timer_seconds=config.turn_timer_seconds,
        slot_reserves_json=slot_reserves,
        status=MapVetoSessionStatus.ACTIVE,
        awaiting_choice=False,
        started_at=now,
        current_step_started_at=now,
    )
    session.add(pick_ban)

    if slots is not None:
        order = 0
        for round_number, (_slot, item_ids) in enumerate(
            zip(sorted(config.slots, key=lambda s: s.position)[: encounter.best_of], slots, strict=True), start=1
        ):
            for item_id in item_ids:
                session.add(
                    PickBanEntry(
                        session=pick_ban,
                        item_id=item_id,
                        order=order,
                        round=round_number,
                        status=MapPoolEntryStatus.AVAILABLE,
                    )
                )
                order += 1
    else:
        for idx, item in enumerate(sorted(config.items, key=lambda i: i.sort_order)):
            session.add(
                PickBanEntry(
                    session=pick_ban,
                    item_id=item.item_id,
                    order=idx,
                    round=None,
                    status=MapPoolEntryStatus.AVAILABLE,
                )
            )

    register_map_veto_realtime_update(session, encounter.id, kind=kind.value)
    if commit:
        try:
            await session.commit()
        except IntegrityError:
            await session.rollback()
            return await get_pick_ban_session(session, encounter.id, kind)
    else:
        await session.flush()
    return pick_ban


async def reset_pick_ban_session(
    session: AsyncSession,
    encounter: Encounter,
    kind: PickBanKind,
    *,
    commit: bool = True,
) -> PickBanSession | None:
    """Hard reset: delete this encounter's `kind`-scoped pick-ban session (its
    entries cascade via the DB FK) and its exclusion ledger, then recreate
    round 1 from scratch. Mirrors ``veto_session.reset_veto_session`` exactly,
    generalized: the ledger clear has no legacy equivalent because
    ``EncounterVetoSession`` never had cross-round memory -- a genuine
    from-scratch reset must also forget what an earlier, scrapped session
    banned/protected, or a later round would wrongly still exclude it."""
    existing = await get_pick_ban_session(session, encounter.id, kind)
    if existing is not None:
        await session.execute(sa.delete(PickBanSession).where(PickBanSession.id == existing.id))
    await session.execute(
        sa.delete(EncounterPickBanLedger).where(
            EncounterPickBanLedger.encounter_id == encounter.id, EncounterPickBanLedger.kind == kind
        )
    )
    await session.flush()
    # Unconditional even if the re-ensure below no-ops: the room just lost its
    # session (same reasoning as veto_session.reset_veto_session).
    register_map_veto_realtime_update(session, encounter.id, kind=kind.value)
    pick_ban = await ensure_pick_ban_session(session, encounter, kind, commit=False)
    if commit:
        await session.commit()
    return pick_ban


async def sync_pick_ban_session_after_team_change(
    session: AsyncSession,
    encounter: Encounter,
    kind: PickBanKind,
) -> None:
    """Team-assignment hook (bracket propagation / admin encounter edits).
    Generalizes ``veto_session.sync_veto_session_after_team_change``.

    Called after an encounter's home/away team ids changed. Both teams now
    set with no session -> ensure one. Session already exists -> the snapshot
    is stale, reset it -- UNLESS an entry is already ``played`` (the map is
    underway; an admin resets manually). Runs inside the caller's
    transaction (no commit).
    """
    pick_ban = await get_pick_ban_session(session, encounter.id, kind)
    if pick_ban is None:
        if encounter.home_team_id is not None and encounter.away_team_id is not None:
            await ensure_pick_ban_session(session, encounter, kind, commit=False)
        return
    played_count = await session.scalar(
        select(sa.func.count())
        .select_from(PickBanEntry)
        .where(PickBanEntry.session_id == pick_ban.id, PickBanEntry.status == MapPoolEntryStatus.PLAYED)
    )
    if played_count:
        return
    await reset_pick_ban_session(session, encounter, kind, commit=False)


async def sync_all_pick_ban_sessions_after_team_change(session: AsyncSession, encounter: Encounter) -> None:
    """``sync_pick_ban_session_after_team_change`` for every kind, in the
    legacy two-arg shape (``session``, ``encounter``) that
    ``admin/encounter.py``, ``challonge/sync.py`` and
    ``encounter/finalize.py``'s ``post_advance`` callback all call. Replaces
    ``veto_session.sync_veto_session_after_team_change`` at all three call
    sites: map's session/entry storage moved to ``PickBanSession``/
    ``PickBanEntry``, so the legacy hook would now create/reset the wrong
    (dead) tables. Also gives hero bans the SAME team-change resilience map
    veto always had -- a pre-existing gap, since nothing called the legacy
    hook for kind=hero before the generic engine existed. Also clears
    ``EncounterReadiness`` -- a confirmation made against one opponent must
    not carry over once the assignment changes."""
    await reset_readiness(session, encounter.id)
    for kind in (PickBanKind.MAP, PickBanKind.HERO):
        await sync_pick_ban_session_after_team_change(session, encounter, kind)


async def advance_to_next_round(
    session: AsyncSession,
    pick_ban: PickBanSession,
    *,
    completed_round: int,
    winner: MapPickSide,
    loser_choice: MapPickSide | None = None,
    commit: bool = True,
) -> PickBanSession:
    """Append the next round's tokens + entries once ``completed_round``'s map
    result is known. No-op (returns ``pick_ban`` unchanged) if the config's
    rotation is not result-dependent — those sessions already carry every
    round's tokens from ``ensure_pick_ban_session``.

    Raises ``pick_ban_engine.RotationNeedsChoice`` when the rotation is
    ``result_loser_choice`` and ``loser_choice`` was not supplied — the caller
    (the RPC handler) must catch this, set ``awaiting_choice=True`` and wait
    for an explicit ``elect_opener`` call instead of resolving a side here.
    """
    config = await session.get(PickBanConfig, pick_ban.config_id) if pick_ban.config_id else None
    if config is None or config.first_ban_rotation not in (
        FirstBanRotation.RESULT_WINNER_FIRST,
        FirstBanRotation.RESULT_LOSER_FIRST,
        FirstBanRotation.RESULT_LOSER_CHOICE,
    ):
        return pick_ban

    next_round = completed_round + 1
    result = await session.execute(
        select(PickBanEntry).where(PickBanEntry.session_id == pick_ban.id, PickBanEntry.round == next_round)
    )
    if result.scalars().first() is not None:
        return pick_ban  # already appended (idempotent re-entry)

    opener = engine.resolve_round_opener(
        rotation=config.first_ban_rotation,
        round_number=next_round,
        session_first_side=pick_ban.first_side or MapPickSide.HOME.value,
        previous_round_winner=winner,
        previous_round_loser_choice=loser_choice,
    )

    ordered_slots = sorted(config.slots, key=lambda s: s.position)
    if next_round > len(ordered_slots):
        return pick_ban  # series is shorter than the config's slot count
    slot = ordered_slots[next_round - 1]

    ledger_result = await session.execute(
        select(EncounterPickBanLedger).where(
            EncounterPickBanLedger.encounter_id == pick_ban.encounter_id,
            EncounterPickBanLedger.kind == pick_ban.kind,
        )
    )
    ledger_rows = [
        engine.LedgerRow(item_id=row.item_id, banned_by_side=row.banned_by_side)
        for row in ledger_result.scalars().all()
    ]
    excluded = engine.excluded_item_ids(ledger_rows, scope=config.no_repeat_scope)
    candidates = [item.item_id for item in slot.items if item.item_id not in excluded]
    if config.mode == MapVetoMode.SLOTS and len(candidates) < SLOT_CANDIDATE_FLOOR:
        # `ensure_pick_ban_session` re-checks this floor against the raw slot
        # size before round 1 starts; nothing re-checked it here once
        # no-repeat exclusion (`no_repeat_scope != none`) has eaten into a
        # later round's pool. Left unguarded, `build_slot_sequence` still
        # emits a bare `decider` for < 2 candidates and the round's entries
        # come up short, so `auto_complete_decider_entry` failed later with
        # an opaque "requires exactly one available item" instead of naming
        # the actual cause here, at round-creation time.
        raise HTTPException(
            status_code=422,
            detail=(
                f"Round {next_round} of the {pick_ban.kind.value} pick-ban has only {len(candidates)} "
                f"candidate(s) left after no-repeat exclusion (needs >= {SLOT_CANDIDATE_FLOOR}) -- fix "
                "this tournament's pick-ban config (slot candidates or no_repeat_scope)."
            ),
        )

    new_tokens = engine.resolve_sequence_tokens(
        build_slot_sequence([len(candidates)], rotation=FirstBanRotation.FIXED.value)
        if config.mode == MapVetoMode.SLOTS
        else list(config.sequence_json),
        opener,
    )
    pick_ban.resolved_sequence_json = [*pick_ban.resolved_sequence_json, *new_tokens]
    pick_ban.awaiting_choice = False
    pick_ban.pending_loser_side = None
    pick_ban.current_step_started_at = datetime.now(UTC)
    if pick_ban.status == MapVetoSessionStatus.COMPLETED:
        pick_ban.status = MapVetoSessionStatus.ACTIVE

    base_order = next_round * 1000  # generous per-round spacing; order is a display/tiebreak field only
    for offset, item_id in enumerate(candidates):
        session.add(
            PickBanEntry(
                session=pick_ban,
                item_id=item_id,
                order=base_order + offset,
                round=next_round,
                status=MapPoolEntryStatus.AVAILABLE,
            )
        )

    register_map_veto_realtime_update(session, pick_ban.encounter_id, kind=pick_ban.kind.value)
    if commit:
        await session.commit()
    else:
        await session.flush()
    return pick_ban



# ── admin config validation + serialization ──────────────────────────────────


def validate_pick_ban_config(sequence: list[str], item_ids: list[int]) -> None:
    """Validate a flat-mode :class:`PickBanConfig` upsert body: same shape as
    ``veto_session.validate_veto_config``, generalized over the wider
    ``PICK_BAN_SEQUENCE_TOKENS`` vocabulary (adds ``protect_first``/
    ``protect_second``)."""
    if not sequence:
        raise HTTPException(status_code=422, detail="sequence must not be empty")
    invalid = sorted({token for token in sequence if token not in engine.PICK_BAN_SEQUENCE_TOKENS})
    if invalid:
        raise HTTPException(status_code=422, detail=f"Invalid sequence token(s): {', '.join(invalid)}")
    decider_positions = [idx for idx, token in enumerate(sequence) if token == "decider"]
    if len(decider_positions) > 1:
        raise HTTPException(status_code=422, detail="sequence may contain at most one decider step")
    if decider_positions and decider_positions[0] != len(sequence) - 1:
        raise HTTPException(status_code=422, detail="decider must be the last step of the sequence")
    if not item_ids:
        raise HTTPException(status_code=422, detail="item_ids must not be empty")
    if len(set(item_ids)) != len(item_ids):
        raise HTTPException(status_code=422, detail="item_ids must be unique")
    if len(sequence) > len(item_ids):
        raise HTTPException(status_code=422, detail="sequence has more steps than items in the pool")
    if not any(token.startswith("pick") or token == "decider" for token in sequence):
        raise HTTPException(status_code=422, detail="sequence must contain at least one pick or a decider")


def validate_pick_ban_slot_config(slots: list[list[int]], *, reserves: list[int | None]) -> None:
    """Validate a slot-mode :class:`PickBanConfig` upsert body. Mirrors
    ``veto_session.validate_slot_config`` verbatim, generalized to "item"
    (map or hero id, per the config's ``kind``) instead of "map"."""
    if not slots:
        raise HTTPException(status_code=422, detail="slots must not be empty")
    if len(reserves) != len(slots):
        raise HTTPException(status_code=422, detail="reserves must have one entry per slot")
    for index, (candidates, reserve) in enumerate(zip(slots, reserves, strict=True), start=1):
        if len(candidates) < SLOT_CANDIDATE_FLOOR:
            raise HTTPException(status_code=422, detail=f"slot {index} must have at least two candidate items")
        if len(set(candidates)) != len(candidates):
            repeated = ", ".join(str(m) for m in sorted({m for m in candidates if candidates.count(m) > 1}))
            raise HTTPException(status_code=422, detail=f"slot {index} must not repeat candidate item(s): {repeated}")
        if reserve is not None and reserve in candidates:
            raise HTTPException(status_code=422, detail=f"slot {index} reserve must not be one of its own candidates")


def serialize_pick_ban_config(config: PickBanConfig) -> dict:
    return {
        "id": config.id,
        "tournament_id": config.tournament_id,
        "kind": config.kind,
        "stage_id": config.stage_id,
        "round": config.round,
        "mode": config.mode,
        "first_pick_rule": config.first_pick_rule,
        "first_ban_rotation": config.first_ban_rotation,
        "turn_timer_seconds": config.turn_timer_seconds,
        "preset": config.preset,
        "sequence": list(config.sequence_json),
        "no_repeat_scope": config.no_repeat_scope,
        "unique_attribute_per_side_per_round": config.unique_attribute_per_side_per_round,
        "allow_protect": config.allow_protect,
        "item_ids": [item.item_id for item in config.items],
        "slots": [
            {
                "position": slot.position,
                "reserve_item_id": slot.reserve_item_id,
                "candidates": [item.item_id for item in slot.items],
            }
            # Play order, not row order -- the relationship's own order_by
            # already sorts a DB-loaded config, but this must not depend on
            # that: a transient/in-memory config (stage-merge copier, tests)
            # is not guaranteed sorted (mirrors map_veto.serialize_veto_config's
            # ordered_slots() guard).
            for slot in sorted(config.slots, key=lambda s: s.position)
        ],
    }
