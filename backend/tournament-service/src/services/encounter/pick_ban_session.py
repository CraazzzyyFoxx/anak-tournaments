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
    PickBanNoRepeatScope,
)
from shared.core.errors import BaseAPIException as HTTPException
from shared.models.matches.match import Match
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


# A config is only ever useful with its pool in hand (`items` in flat mode,
# `slots.items` in slot mode), and both are plain lazy relationships: touching
# either on a config that was loaded without them raises `MissingGreenlet`
# under async SQLAlchemy. Every load of a config that will be read goes
# through here.
_CONFIG_POOL_LOAD = (
    selectinload(PickBanConfig.items),
    selectinload(PickBanConfig.slots).selectinload(PickBanConfigSlot.items),
)


async def _load_config(session: AsyncSession, config_id: int) -> PickBanConfig | None:
    """One config by id, pool eagerly loaded.

    A `select` rather than `session.get`: loader options are ignored when the
    row is already in the identity map (which it can be, e.g. after
    `pick_ban_action` fetched it for a scalar flag), and the pool would still
    come back unloaded.
    """
    return await session.scalar(select(PickBanConfig).where(PickBanConfig.id == config_id).options(*_CONFIG_POOL_LOAD))


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
        .options(*_CONFIG_POOL_LOAD)
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

# The hero phase of a round bans FOR a known map, so it cannot open before the
# map pick-ban has settled that round's map (design §4: both rulebooks ban
# heroes once per map of the series). Not a config problem -- it resolves on
# its own as the map phase progresses -- so it is reported separately from the
# REASON_* set above.
REASON_WAITING_MAP = "waiting_map"


def rounds_are_progressive(config: PickBanConfig, kind: PickBanKind) -> bool:
    """Whether this config's rounds are created one map at a time.

    Slot mode says so structurally -- one slot IS one map of the series -- and
    every hero config says so by domain: heroes are banned per map, never once
    per series (design §4). A flat ``kind=map`` config is the legacy classic
    veto, one sequence that settles the whole series' map order up front, and
    stays single-round (``PickBanEntry.round IS NULL``).
    """
    return config.mode == MapVetoMode.SLOTS or kind == PickBanKind.HERO


def build_round_sequence(
    config: PickBanConfig, kind: PickBanKind, *, candidate_count: int, opener: MapPickSide | str
) -> list[str]:
    """The resolved step tokens for ONE round of a progressive session.

    Slot mode spends ``candidates - 1`` bans and closes on a ``decider``, which
    is what makes the round's step count equal its candidate count. A hero
    round instead runs the config's own sequence verbatim, once per map --
    minus any ``decider``, which asks "whatever survived the bans is the pick"
    and is a map-veto idea: a hero round leaves the whole unbanned pool
    playable, so that step could never resolve (``auto_complete_decider_entry``
    needs exactly one available item) and would stall the room.
    """
    tokens = (
        build_slot_sequence([candidate_count], rotation=FirstBanRotation.FIXED.value)
        if config.mode == MapVetoMode.SLOTS
        else [token for token in config.sequence_json if token != "decider"]
    )
    return engine.resolve_sequence_tokens(tokens, opener)


async def settled_map_rounds(session: AsyncSession, encounter_id: int) -> int:
    """How many maps of the series the map pick-ban has settled -- picked, and
    possibly already played.

    Mode-agnostic on purpose: rounds resolve in order, so the count of decided
    entries IS the highest settled round for a slot-mode session (one pick per
    round) and for the legacy flat one (the whole order picked up front)
    alike.
    """
    pick_ban = await get_pick_ban_session(session, encounter_id, PickBanKind.MAP)
    if pick_ban is None:
        return 0
    settled = await session.scalar(
        select(sa.func.count())
        .select_from(PickBanEntry)
        .where(
            PickBanEntry.session_id == pick_ban.id,
            PickBanEntry.status.in_((MapPoolEntryStatus.PICKED, MapPoolEntryStatus.PLAYED)),
        )
    )
    return int(settled or 0)


async def map_round_settled(session: AsyncSession, encounter: Encounter, round_number: int) -> bool:
    """Whether the map that round ``round_number`` will be played on is decided
    -- the precondition for that round's hero bans opening. An encounter with
    no map pick-ban configured has no map phase to wait on."""
    if await _resolve_config(session, encounter, PickBanKind.MAP) is None:
        return True
    return await settled_map_rounds(session, encounter.id) >= round_number


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
    if kind == PickBanKind.HERO and not await map_round_settled(session, encounter, 1):
        return REASON_WAITING_MAP
    return REASON_NOT_CONFIGURED


async def ensure_pick_ban_session(
    session: AsyncSession,
    encounter: Encounter,
    kind: PickBanKind,
    *,
    commit: bool = True,
) -> PickBanSession | None:
    """Idempotently create the FIRST round of the encounter's pick-ban session.

    Round 1 resolves exactly as it always did (same cascade-resolved config,
    same seed resolution, same slot validation). What the progressive loop
    changed is what the session is created holding: when its rounds are
    progressive (``rounds_are_progressive``) it gets round 1 and nothing else,
    and every later round is appended one at a time by
    ``advance_to_next_round`` as the series is played — so round 2's bans
    cannot be taken before round 1's map has been played (design Decisions
    4/5). A flat ``kind=map`` config is untouched: it still gets its whole
    sequence and pool up front, because that IS the legacy classic veto.
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

    # Heroes are banned FOR a map, so a hero session cannot open before the map
    # pick-ban has settled round 1's map. `sync_hero_rounds` keeps every later
    # hero round behind the same gate.
    if kind == PickBanKind.HERO and not await map_round_settled(session, encounter, 1):
        return None

    pool_size = sum(len(s) for s in slots) if slots is not None else len(config.items)
    seeds = await resolve_seeds(session, encounter)
    now = datetime.now(UTC)
    flat_item_ids = [item.item_id for item in sorted(config.items, key=lambda item: item.sort_order)]
    progressive = rounds_are_progressive(config, kind)
    # Round 1's candidates: its slot in slot mode, the whole configured pool in
    # a (per-round) flat one.
    round_one_item_ids = slots[0] if slots is not None else flat_item_ids

    pick_ban = PickBanSession(
        encounter_id=encounter.id,
        kind=kind,
        config_id=config.id,
        first_side=seeds.first_side,
        seed_source=seeds.seed_source,
        home_seed=seeds.home_seed,
        away_seed=seeds.away_seed,
        resolved_sequence_json=(
            build_round_sequence(
                config, kind, candidate_count=len(round_one_item_ids), opener=seeds.first_side
            )
            if progressive
            else engine.resolve_sequence_tokens(
                build_sequence_for_best_of(encounter.best_of, pool_size)
                if config.preset != "custom"
                else list(config.sequence_json),
                seeds.first_side,
            )
        ),
        turn_timer_seconds=config.turn_timer_seconds,
        slot_reserves_json=slot_reserves,
        status=MapVetoSessionStatus.ACTIVE,
        awaiting_choice=False,
        started_at=now,
        current_step_started_at=now,
    )
    session.add(pick_ban)

    if progressive:
        for offset, item_id in enumerate(round_one_item_ids):
            session.add(
                PickBanEntry(
                    session=pick_ban,
                    item_id=item_id,
                    order=offset,
                    round=1,
                    status=MapPoolEntryStatus.AVAILABLE,
                )
            )
    else:
        for idx, item_id in enumerate(flat_item_ids):
            session.add(
                PickBanEntry(
                    session=pick_ban,
                    item_id=item_id,
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
    banned, or a later round would wrongly still exclude it."""
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
    winner: MapPickSide | str | None,
    loser_choice: MapPickSide | None = None,
    commit: bool = True,
) -> PickBanSession:
    """Append the round after ``completed_round``: its step tokens and its
    candidate entries.

    This is the barrier between two maps of a series (design Decision 5). It
    is a no-op, returning ``pick_ban`` unchanged, unless all of:

    - the session's rounds are progressive (``rounds_are_progressive``) — a
      flat ``kind=map`` veto settles the whole series at once and has no later
      round to open;
    - the round currently in play is fully resolved — a new round is never
      stacked on top of an unfinished one, which is what keeps
      ``get_current_step``'s "index into the sequence" arithmetic honest;
    - the next round has not been appended already (idempotent re-entry);
    - the config still describes that round (slot count) and the series still
      has that many maps (``best_of``).

    ``winner`` is the previous map's winner, or ``None`` when it drew or is
    unknown. A drawn map names no winner, so a result-dependent rotation has
    nothing to rotate on and falls back to the session's established opener
    rather than stalling the series.

    Raises ``pick_ban_engine.RotationNeedsChoice`` when the rotation is
    ``result_loser_choice`` and ``loser_choice`` was not supplied — the caller
    must catch this, set ``awaiting_choice=True`` and wait for an explicit
    ``elect_opener`` call instead of resolving a side here.
    """
    config = await _load_config(session, pick_ban.config_id) if pick_ban.config_id else None
    if config is None or not rounds_are_progressive(config, pick_ban.kind):
        return pick_ban

    entries_result = await session.execute(select(PickBanEntry).where(PickBanEntry.session_id == pick_ban.id))
    entries = list(entries_result.scalars().all())
    if engine.get_current_step(pick_ban.resolved_sequence_json, entries) is not None:
        return pick_ban  # the round in play still has steps left to take

    next_round = completed_round + 1
    if any(entry.round == next_round for entry in entries):
        return pick_ban  # already appended (idempotent re-entry)

    encounter = await session.get(Encounter, pick_ban.encounter_id)
    if encounter is None:
        return pick_ban

    if config.mode == MapVetoMode.SLOTS:
        # The bracket owns series length, so the config's tail beyond `best_of`
        # is out of play (same rule `ensure_pick_ban_session` applies).
        ordered_slots = sorted(config.slots, key=lambda s: s.position)[: encounter.best_of]
        if next_round > len(ordered_slots):
            return pick_ban  # series is shorter than the config's slot count
        candidate_item_ids = [item.item_id for item in ordered_slots[next_round - 1].items]
    else:
        if next_round > encounter.best_of:
            return pick_ban  # every map of the series already has its round
        candidate_item_ids = [item.item_id for item in sorted(config.items, key=lambda item: item.sort_order)]

    rotation = config.first_ban_rotation
    if winner is None and rotation in (
        FirstBanRotation.RESULT_WINNER_FIRST,
        FirstBanRotation.RESULT_LOSER_FIRST,
        FirstBanRotation.RESULT_LOSER_CHOICE,
    ):
        rotation = FirstBanRotation.FIXED
    opener = engine.resolve_round_opener(
        rotation=rotation,
        round_number=next_round,
        session_first_side=pick_ban.first_side or MapPickSide.HOME.value,
        previous_round_winner=winner,
        previous_round_loser_choice=loser_choice,
    )

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
    # Only the side-blind scope can be applied to a pool both sides draw from;
    # `encounter_same_side` is per-side by definition and is enforced when an
    # action is taken instead (`pick_ban_action.apply_pick_ban_action`).
    excluded = (
        engine.excluded_item_ids(ledger_rows, scope=config.no_repeat_scope)
        if config.no_repeat_scope == PickBanNoRepeatScope.ENCOUNTER
        else set()
    )
    candidates = [item_id for item_id in candidate_item_ids if item_id not in excluded]
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

    new_tokens = build_round_sequence(config, pick_ban.kind, candidate_count=len(candidates), opener=opener)
    if len(candidates) < len(new_tokens):
        # A round with more steps than candidates cannot resolve: the last
        # steps would have nothing left to act on and the room would stall on
        # a turn nobody can take.
        raise HTTPException(
            status_code=422,
            detail=(
                f"Round {next_round} of the {pick_ban.kind.value} pick-ban has {len(candidates)} "
                f"candidate(s) for {len(new_tokens)} step(s) -- fix this tournament's pick-ban config "
                "(pool size, sequence length or no_repeat_scope)."
            ),
        )

    # Closing the finished round drops the candidates nobody acted on: the
    # round in play is the lowest one with anything AVAILABLE, so leftovers (a
    # hero round bans 4 of 40) would keep naming the finished round as current
    # and scope every later action to it. Nothing is lost — an untouched
    # candidate carries no state — and the step arithmetic is untouched, since
    # `get_current_step` only ever counts entries that are NOT available.
    await session.execute(
        sa.delete(PickBanEntry).where(
            PickBanEntry.session_id == pick_ban.id,
            PickBanEntry.round == completed_round,
            PickBanEntry.status == MapPoolEntryStatus.AVAILABLE,
        )
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


async def map_round_winner(session: AsyncSession, encounter: Encounter, round_number: int) -> str | None:
    """Who won map ``round_number`` of the series, per the ``Match`` row its
    result was reconciled into (``map_report.submit_map_report``).

    ``None`` when that map is not decided yet, has no result in yet, or drew --
    every caller treats all three the same way: there is no winner to rotate a
    round's opener on.
    """
    if round_number < 1:
        return None
    map_pick_ban = await get_pick_ban_session(session, encounter.id, PickBanKind.MAP)
    if map_pick_ban is None:
        return None
    result = await session.execute(
        select(PickBanEntry).where(
            PickBanEntry.session_id == map_pick_ban.id,
            PickBanEntry.status.in_((MapPoolEntryStatus.PICKED, MapPoolEntryStatus.PLAYED)),
        )
    )
    settled = sorted(
        result.scalars().all(),
        key=lambda entry: entry.action_index if entry.action_index is not None else entry.order,
    )
    if len(settled) < round_number:
        return None
    match = await session.scalar(
        select(Match).where(
            Match.encounter_id == encounter.id, Match.map_id == settled[round_number - 1].item_id
        )
    )
    if match is None:
        return None
    return engine.winner_side(match.home_score, match.away_score)


async def sync_hero_rounds(session: AsyncSession, encounter: Encounter, *, commit: bool = True) -> None:
    """Keep the hero session's rounds in lockstep with the maps the map
    pick-ban has settled: hero round N opens once map N is picked, and not
    before, because heroes are banned for a KNOWN map (design §4).

    Lazy and read-triggered, like the room's other self-healing steps
    (``auto_complete_decider``/``auto_resolve_timeout``): there is no event for
    "a map just got picked", so the hero session catches up the next time
    anyone reads or acts on it. One round per call in practice —
    ``advance_to_next_round`` refuses to open round N+1 while round N is
    unfinished, which is exactly the loop's own barrier.
    """
    hero = await get_pick_ban_session(session, encounter.id, PickBanKind.HERO)
    if hero is None or hero.status == MapVetoSessionStatus.CANCELLED:
        return
    target = min(await settled_map_rounds(session, encounter.id), encounter.best_of)
    highest = await highest_round_of(session, hero) or 0
    while highest < target:
        winner = await map_round_winner(session, encounter, highest)
        try:
            await advance_to_next_round(
                session, hero, completed_round=highest, winner=winner, commit=False
            )
        except engine.RotationNeedsChoice:
            # `result_loser_choice`: the round waits for the losing captain's
            # `elect_opener` call, which resumes this same append.
            hero.awaiting_choice = True
            hero.pending_loser_side = MapPickSide.AWAY.value if winner == MapPickSide.HOME.value else MapPickSide.HOME.value
            await session.flush()
            break
        appended = await highest_round_of(session, hero) or 0
        if appended <= highest:
            break  # the append declined (round unfinished, or the config/series ran out)
        highest = appended
    if commit:
        await session.commit()


# ── admin config validation + serialization ──────────────────────────────────


def validate_pick_ban_config(sequence: list[str], item_ids: list[int], *, kind: PickBanKind) -> None:
    """Validate a flat-mode :class:`PickBanConfig` upsert body: same shape as
    ``veto_session.validate_veto_config``, generalized over the wider
    ``PICK_BAN_SEQUENCE_TOKENS`` vocabulary (adds ``protect_first``/
    ``protect_second``) and over ``kind``.

    A ``kind=hero`` sequence is ONE round's worth of steps, replayed for every
    map of the series (``rounds_are_progressive``), and it bans out of a pool
    that stays playable: there is no survivor for a ``decider`` to resolve to,
    so the map rule "must end in a pick or a decider" does not apply and a
    ``decider`` is refused outright rather than stalling the room later.
    """
    if not sequence:
        raise HTTPException(status_code=422, detail="sequence must not be empty")
    invalid = sorted({token for token in sequence if token not in engine.PICK_BAN_SEQUENCE_TOKENS})
    if invalid:
        raise HTTPException(status_code=422, detail=f"Invalid sequence token(s): {', '.join(invalid)}")
    decider_positions = [idx for idx, token in enumerate(sequence) if token == "decider"]
    if kind == PickBanKind.HERO and decider_positions:
        raise HTTPException(status_code=422, detail="a hero sequence must not contain a decider step")
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
    if kind == PickBanKind.MAP and not any(token.startswith("pick") or token == "decider" for token in sequence):
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
