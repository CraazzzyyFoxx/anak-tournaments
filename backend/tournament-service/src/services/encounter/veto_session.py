"""Veto session lifecycle: config cascade, seed resolution, init/reset hooks.

An :class:`~shared.models.tournament.encounter_map.EncounterVetoSession` is the
1:1 snapshot of one encounter's veto room. It is created idempotently
(``ensure_veto_session``) once both teams are known and a config resolves via
the ``(stage, round) -> (stage, NULL) -> (NULL, NULL)`` cascade, freezing the
seed resolution and the side-resolved step sequence so later config edits or
standings recalculations never change a running veto. Resetting = delete the
session + pool rows and re-create.

Commit semantics mirror ``map_veto.initialize_map_pool``: the lifecycle
functions commit internally by default; the team-change hook runs with
``commit=False`` inside the caller's transaction (bracket propagation / admin
encounter updates own the commit boundary there).

The step engine itself (turn validation, action application, decider
auto-resolve) lives in ``map_veto.py``; this module must not import it.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
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
    VetoSeedSource,
)
from shared.core.errors import BaseAPIException as HTTPException
from src import models
from src.services.encounter.realtime_commit import register_map_veto_realtime_update

# Side-agnostic step tokens allowed on MapVetoConfig.veto_sequence_json.
VETO_SEQUENCE_TOKENS = frozenset({"ban_first", "ban_second", "pick_first", "pick_second", "decider"})

# ``session: null`` reasons on the state read path (mirrors the frontend's
# VetoUnavailableReason union).
REASON_TEAMS_UNKNOWN = "teams_unknown"
REASON_NOT_CONFIGURED = "not_configured"


# ── config validation & cascade ─────────────────────────────────────────────


def validate_veto_config(sequence: list[str], map_ids: list[int]) -> None:
    """Validate a config upsert body (sequence tokens + map pool coherence)."""
    if not sequence:
        raise HTTPException(status_code=422, detail="sequence must not be empty")
    invalid = sorted({token for token in sequence if token not in VETO_SEQUENCE_TOKENS})
    if invalid:
        raise HTTPException(status_code=422, detail=f"Invalid sequence token(s): {', '.join(invalid)}")
    decider_positions = [idx for idx, token in enumerate(sequence) if token == "decider"]
    if len(decider_positions) > 1:
        raise HTTPException(status_code=422, detail="sequence may contain at most one decider step")
    if decider_positions and decider_positions[0] != len(sequence) - 1:
        raise HTTPException(status_code=422, detail="decider must be the last step of the sequence")
    if not map_ids:
        raise HTTPException(status_code=422, detail="map_ids must not be empty")
    if len(set(map_ids)) != len(map_ids):
        raise HTTPException(status_code=422, detail="map_ids must be unique")
    if len(sequence) > len(map_ids):
        raise HTTPException(status_code=422, detail="sequence has more steps than maps in the pool")
    if not any(token.startswith("pick") or token == "decider" for token in sequence):
        raise HTTPException(status_code=422, detail="sequence must contain at least one pick or a decider")


# ── series length (owned by the bracket) ─────────────────────────────────────

#: The only preset value that opts a config out of bracket-driven series
#: length. Everything else -- the canonical ``"bracket"``, a legacy ``"bo3"``
#: template label, or NULL from before the column existed -- is bracket-driven:
#: none of them is a deliberately hand-authored step order.
CUSTOM_PRESET = "custom"

#: What the admin editor writes for a config that follows the bracket. Stored
#: for provenance only; the check above is negative, so the server never has to
#: know this value to behave correctly.
BRACKET_PRESET = "bracket"

#: Opening bans a generated sequence uses when the pool can spare them.
LEAD_BANS = 2


def build_sequence_for_best_of(best_of: int, pool_size: int) -> list[str]:
    """Generate a side-agnostic sequence that plays exactly ``best_of`` maps.

    Shape: a pair of opening bans, then alternating picks, then a decider when
    the series length is odd. This reproduces the Bo2/Bo3/Bo5 presets token for
    token and extends to any N, so a bracket configured Bo7 is no longer a
    length the veto has no sequence for.

    Bo1 is the exception: its standard veto bans the pool down to a single map
    rather than opening two bans and deciding immediately, so it keeps that
    shape.

    Opening bans are dropped as needed to keep the sequence no longer than the
    pool — the same rule ``validate_veto_config`` enforces on upsert.
    """
    if pool_size < 1:
        return []
    if best_of <= 1:
        tokens = ["ban_first" if index % 2 == 0 else "ban_second" for index in range(pool_size - 1)]
        tokens.append("decider")
        return tokens

    # A pool smaller than the series cannot play the whole series; clamp rather
    # than emit a sequence the step engine would run off the end of.
    played = min(best_of, pool_size)
    picks = played - 1 if played % 2 else played
    bans = max(0, min(LEAD_BANS, pool_size - played))

    tokens = ["ban_first" if index % 2 == 0 else "ban_second" for index in range(bans)]
    tokens.extend("pick_first" if index % 2 == 0 else "pick_second" for index in range(picks))
    if played % 2:
        tokens.append("decider")
    return tokens


def effective_sequence(
    config: models.MapVetoConfig,
    best_of: int,
    pool_size: int,
    *,
    slots: list[list[int]] | None = None,
) -> list[str]:
    """The sequence a session should actually run.

    The bracket owns series length. ``Encounter.best_of`` is resolved from
    ``Stage.settings_json['best_of']`` by the generator and may additionally
    carry a per-encounter admin override, so a preset-backed config is
    regenerated from it instead of trusting the length its template happened to
    be authored with — the two used to diverge silently, handing a Bo2 match a
    three-map veto.

    An explicitly ``custom`` config is the organizer's own step order and is
    passed through untouched; the admin editor flags it when its map count
    disagrees with the bracket.

    Slot mode ignores all three of ``best_of``, ``pool_size`` and the stored
    sequence: the slots ARE the series (one played map each) and they carry
    their own candidate counts, so ``slots`` — candidate map ids per slot in
    position order, from ``load_slot_candidates`` — is the only input. It is
    checked before the flat guards on purpose: ``preset == 'custom'`` is
    unstorable alongside ``mode = 'slots'``
    (``ck_map_veto_config_slots_not_custom``) and a slot config has no
    hand-authored order to fall back to, while a legacy ``best_of = 0`` says
    nothing about slots that describe their own length.
    """
    if config.mode == MapVetoMode.SLOTS:
        if slots is None:
            # The caller's bug, not the organizer's: every slot-mode call site
            # must load the candidates. Falling through to the flat path would
            # run a plausible-looking veto for the wrong pool shape, so this
            # fails loudly instead of raising the validator's 422 alongside
            # messages an admin is meant to act on.
            raise TypeError("effective_sequence() requires slots= for a slot-mode config")
        return build_slot_sequence(
            [len(candidates) for candidates in slots],
            rotation=config.first_ban_rotation,
        )

    stored = list(config.veto_sequence_json or [])
    if config.preset == CUSTOM_PRESET:
        return stored
    if best_of < 1:
        # Legacy/degenerate rows carry best_of=0; the stored template is a
        # better guess than an empty sequence.
        return stored
    return build_sequence_for_best_of(best_of, pool_size)


# ── slot mode ────────────────────────────────────────────────────────────────


def build_slot_sequence(candidate_counts: list[int], *, rotation: str) -> list[str]:
    """Generate the side-agnostic sequence for a slot-mode config.

    Each slot contributes ``(candidates - 1)`` alternating bans and one
    ``decider`` that closes it, so the step total equals the pool size and
    ``get_current_step``'s arithmetic keeps working unchanged.

    ``rotation``: ``fixed`` opens every slot with the higher seed; ``alternate``
    opens even ``slot_index`` values with the higher seed and odd ones with the
    lower — in the design's 1-based ordinals, the first, third and fifth slots
    open with the higher seed (design Decision 3).

    NOTE: the result carries one decider per slot, mid-sequence. It is a SESSION
    sequence and must never be passed to ``validate_veto_config``, which rejects
    more than one decider and requires it last. That validator guards config
    upserts only (design Decision 16).
    """
    tokens: list[str] = []
    for slot_index, candidate_count in enumerate(candidate_counts):
        opens_first = rotation != FirstBanRotation.ALTERNATE or slot_index % 2 == 0
        opener, responder = ("ban_first", "ban_second") if opens_first else ("ban_second", "ban_first")
        tokens.extend(opener if ban_index % 2 == 0 else responder for ban_index in range(candidate_count - 1))
        tokens.append("decider")
    return tokens


def slot_candidates(slots: Sequence[models.MapVetoConfigSlot]) -> list[list[int]]:
    """Candidate map ids per slot as plain data, in ``position`` order.

    The sort is load-bearing, not tidiness: a mis-ordered slot list still spends
    the right *number* of steps, so the pool-size invariant ``get_current_step``
    relies on stays satisfied while slot 1 is offered another slot's ban count.
    Nothing downstream could detect it, so the order is established here rather
    than left to a query's row order or to a relationship's ``order_by``.

    Requires each slot's ``maps`` to be loaded; ``load_slot_candidates`` is the
    await-safe way to get that.
    """
    return [[entry.map_id for entry in slot.maps] for slot in sorted(slots, key=lambda slot: slot.position)]


async def load_slot_candidates(session: AsyncSession, config: models.MapVetoConfig) -> list[list[int]]:
    """Fetch ``config``'s slot candidates for ``effective_sequence``.

    ``MapVetoConfig.slots`` is deliberately lazy and ``effective_sequence`` is
    synchronous, so the async session-creation path cannot reach the slot chain
    through the relationship without risking ``MissingGreenlet``. Querying the
    slots directly keeps the eager-load visible at the call site — the
    convention the model documents — and does not depend on whoever loaded
    ``config`` having asked for the two-level chain.

    A slot with no candidate maps comes back as an empty list rather than
    disappearing: session creation re-checks the ``>= 2`` floor, and silently
    dropping the slot would shorten the sequence instead.
    """
    result = await session.execute(
        select(models.MapVetoConfigSlot)
        .where(models.MapVetoConfigSlot.map_veto_config_id == config.id)
        .options(selectinload(models.MapVetoConfigSlot.maps))
    )
    return slot_candidates(list(result.scalars().all()))


def validate_slot_config(slots: list[list[int]], *, reserves: list[int | None]) -> None:
    """Validate a slot-mode config upsert.

    ``index`` in the messages is the slot's 1-based ``position``, so callers
    must pass ``slots`` in position order: the schema guarantees positions are
    unique and >= 1, not that they are contiguous.

    Slots need >= 2 candidates. ``build_slot_sequence`` spends ``c_i - 1`` bans
    on a slot, so a single-candidate one contributes a bare ``decider`` that
    lands back-to-back with the previous slot's. ``auto_complete_decider``
    resolves at most one decider per call and ``get_map_pool`` calls it once per
    state read, so consecutive deciders advance only one per read (design
    Decision 15).

    A map may repeat across slots -- only within-slot duplication is
    meaningless, since a slot bans its own candidates down to one survivor. A
    slot's reserve -- the map the regulation replays if that slot's map draws --
    must likewise not be one of its own candidates: it would either be banned
    there and then reinstated as that slot's replay map, or be the survivor,
    making the replay the very map that drew (Decision 7).
    """
    if not slots:
        raise HTTPException(status_code=422, detail="slots must not be empty")
    if len(reserves) != len(slots):
        raise HTTPException(status_code=422, detail="reserves must have one entry per slot")
    for index, (candidates, reserve) in enumerate(zip(slots, reserves, strict=True), start=1):
        if len(candidates) < 2:
            raise HTTPException(status_code=422, detail=f"slot {index} must have at least two candidate maps")
        if len(set(candidates)) != len(candidates):
            repeated = ", ".join(str(m) for m in sorted({m for m in candidates if candidates.count(m) > 1}))
            raise HTTPException(status_code=422, detail=f"slot {index} must not repeat candidate map(s): {repeated}")
        if reserve is not None and reserve in candidates:
            raise HTTPException(status_code=422, detail=f"slot {index} reserve must not be one of its own candidates")


def select_config(
    configs: list[models.MapVetoConfig],
    *,
    stage_id: int | None,
    round: int | None,
) -> models.MapVetoConfig | None:
    """Pick the most specific applicable config: (stage, round) > (stage, NULL) > (NULL, NULL)."""

    def specificity(config: models.MapVetoConfig) -> int:
        if config.stage_id is not None and config.round is not None:
            return 0
        if config.stage_id is not None:
            return 1
        return 2

    best: models.MapVetoConfig | None = None
    for config in configs:
        if config.stage_id is not None and (stage_id is None or config.stage_id != stage_id):
            continue
        if config.round is not None and config.round != round:
            continue
        if best is None or specificity(config) < specificity(best):
            best = config
    return best


async def resolve_config(session: AsyncSession, encounter: models.Encounter) -> models.MapVetoConfig | None:
    """Cascade-resolve the veto config applicable to this encounter."""
    result = await session.execute(
        select(models.MapVetoConfig)
        .where(
            models.MapVetoConfig.tournament_id == encounter.tournament_id,
            sa.or_(
                models.MapVetoConfig.stage_id.is_(None),
                models.MapVetoConfig.stage_id == encounter.stage_id,
            ),
        )
        .options(selectinload(models.MapVetoConfig.map_pool))
    )
    return select_config(
        list(result.scalars().all()),
        stage_id=encounter.stage_id,
        round=encounter.round,
    )


# ── seed resolution ──────────────────────────────────────────────────────────


@dataclass(frozen=True)
class SeedResolution:
    home_seed: int | None
    away_seed: int | None
    seed_source: VetoSeedSource
    first_side: MapPickSide


def decide_seeds(
    home_slot: int | None,
    away_slot: int | None,
    home_position: int | None,
    away_position: int | None,
) -> SeedResolution:
    """Pure seed decision: bracket slot -> previous-stage standings -> fallback home.

    LOWER seed number = higher seed = acts FIRST. A level resolves only when
    BOTH sides have a distinct value there; a tie keeps the (informational)
    seeds but falls back to home acting first.
    """
    if home_slot is not None and away_slot is not None:
        if home_slot == away_slot:
            return SeedResolution(home_slot, away_slot, VetoSeedSource.FALLBACK_HOME, MapPickSide.HOME)
        first = MapPickSide.HOME if home_slot < away_slot else MapPickSide.AWAY
        return SeedResolution(home_slot, away_slot, VetoSeedSource.BRACKET_SLOT, first)
    if home_position is not None and away_position is not None:
        if home_position == away_position:
            return SeedResolution(home_position, away_position, VetoSeedSource.FALLBACK_HOME, MapPickSide.HOME)
        first = MapPickSide.HOME if home_position < away_position else MapPickSide.AWAY
        return SeedResolution(home_position, away_position, VetoSeedSource.STANDINGS, first)
    return SeedResolution(None, None, VetoSeedSource.FALLBACK_HOME, MapPickSide.HOME)


async def resolve_seeds(session: AsyncSession, encounter: models.Encounter) -> SeedResolution:
    """Resolve both teams' seeds for the encounter (snapshot at session init).

    1. ``StageItemInput.slot`` of the encounter's stage item (seed = slot).
    2. ``Standing.position`` of the previous stage (by ``Stage.order`` within
       the tournament; min position when a team has rows in several items).
    3. Fallback: home acts first, ``seed_source=fallback_home``.
    """
    home_team_id = encounter.home_team_id
    away_team_id = encounter.away_team_id
    if home_team_id is None or away_team_id is None:
        return decide_seeds(None, None, None, None)
    team_ids = (home_team_id, away_team_id)

    home_slot: int | None = None
    away_slot: int | None = None
    if encounter.stage_item_id is not None:
        rows = await session.execute(
            select(models.StageItemInput.team_id, models.StageItemInput.slot).where(
                models.StageItemInput.stage_item_id == encounter.stage_item_id,
                models.StageItemInput.team_id.in_(team_ids),
            )
        )
        for team_id, slot in rows.all():
            if team_id == home_team_id:
                home_slot = slot
            elif team_id == away_team_id:
                away_slot = slot
    if home_slot is not None and away_slot is not None:
        return decide_seeds(home_slot, away_slot, None, None)

    home_position: int | None = None
    away_position: int | None = None
    if encounter.stage_id is not None:
        current_order = await session.scalar(select(models.Stage.order).where(models.Stage.id == encounter.stage_id))
        previous_stage_id = None
        if current_order is not None:
            previous_stage_id = await session.scalar(
                select(models.Stage.id)
                .where(
                    models.Stage.tournament_id == encounter.tournament_id,
                    models.Stage.order < current_order,
                )
                .order_by(models.Stage.order.desc())
                .limit(1)
            )
        if previous_stage_id is not None:
            rows = await session.execute(
                select(models.Standing.team_id, sa.func.min(models.Standing.position))
                .where(
                    models.Standing.stage_id == previous_stage_id,
                    models.Standing.team_id.in_(team_ids),
                )
                .group_by(models.Standing.team_id)
            )
            for team_id, position in rows.all():
                if team_id == home_team_id:
                    home_position = position
                elif team_id == away_team_id:
                    away_position = position

    return decide_seeds(home_slot, away_slot, home_position, away_position)


# ── sequence token mapping ───────────────────────────────────────────────────


def resolve_sequence_tokens(sequence: list[str], first_side: MapPickSide | str) -> list[str]:
    """Map side-agnostic ``*_first``/``*_second`` tokens onto home/away."""
    first = first_side.value if isinstance(first_side, MapPickSide) else first_side
    second = "away" if first == "home" else "home"
    resolved: list[str] = []
    for token in sequence:
        if token == "decider":
            resolved.append("decider")
            continue
        action, slot = token.split("_", 1)
        resolved.append(f"{action}_{first if slot == 'first' else second}")
    return resolved


# ── session lifecycle ────────────────────────────────────────────────────────


async def get_veto_session(
    session: AsyncSession,
    encounter_id: int,
    *,
    for_update: bool = False,
) -> models.EncounterVetoSession | None:
    query = select(models.EncounterVetoSession).where(models.EncounterVetoSession.encounter_id == encounter_id)
    if for_update:
        query = query.with_for_update()
    result = await session.execute(query)
    return result.scalar_one_or_none()


def unavailable_reason(encounter: models.Encounter) -> str:
    """Why ``ensure_veto_session`` returned None for this encounter."""
    if encounter.home_team_id is None or encounter.away_team_id is None:
        return REASON_TEAMS_UNKNOWN
    return REASON_NOT_CONFIGURED


async def ensure_veto_session(
    session: AsyncSession,
    encounter: models.Encounter,
    *,
    commit: bool = True,
) -> models.EncounterVetoSession | None:
    """Idempotently create the encounter's veto session (and pool) if possible.

    Returns the existing session untouched when one exists. No-ops (returns
    None) when either team is unknown or no config cascades onto the
    encounter — ``unavailable_reason`` names which. The config pool is copied
    to ``encounter_map_pool`` ONLY when the encounter has no pool rows yet, so
    a pre-existing admin-assigned pool is respected.

    The step sequence comes from ``effective_sequence``: the bracket's
    ``best_of`` drives it unless the config is explicitly ``custom``, and a
    slot-mode config derives it from its slots instead.
    """
    existing = await get_veto_session(session, encounter.id)
    if existing is not None:
        return existing
    if encounter.home_team_id is None or encounter.away_team_id is None:
        return None
    config = await resolve_config(session, encounter)
    if config is None:
        return None

    # Counted before the sequence is built, not after: a generated sequence is
    # sized against the pool it will actually draw from, which is the
    # admin-assigned pool when one already exists and the config's otherwise.
    pool_count = await session.scalar(
        select(sa.func.count())
        .select_from(models.EncounterMapPool)
        .where(models.EncounterMapPool.encounter_id == encounter.id)
    )
    pool_size = pool_count or len(config.map_pool)
    # Slot mode only, and awaited here because ``effective_sequence`` is sync:
    # the slot chain is lazy, so it must be fetched before the pure function
    # needs it.
    slots = await load_slot_candidates(session, config) if config.mode == MapVetoMode.SLOTS else None

    seeds = await resolve_seeds(session, encounter)
    now = datetime.now(UTC)
    veto = models.EncounterVetoSession(
        encounter_id=encounter.id,
        config_id=config.id,
        first_side=seeds.first_side,
        seed_source=seeds.seed_source,
        home_seed=seeds.home_seed,
        away_seed=seeds.away_seed,
        resolved_sequence_json=resolve_sequence_tokens(
            effective_sequence(config, encounter.best_of, pool_size, slots=slots), seeds.first_side
        ),
        turn_timer_seconds=config.turn_timer_seconds,
        status=MapVetoSessionStatus.ACTIVE,
        started_at=now,
        current_step_started_at=now,
    )
    session.add(veto)

    if not pool_count:
        for idx, config_map in enumerate(config.map_pool):
            session.add(
                models.EncounterMapPool(
                    encounter_id=encounter.id,
                    map_id=config_map.map_id,
                    order=idx,
                    status=MapPoolEntryStatus.AVAILABLE,
                )
            )

    register_map_veto_realtime_update(session, encounter.id)
    if commit:
        try:
            await session.commit()
        except IntegrityError:
            # A concurrent reader created the session first — use theirs.
            await session.rollback()
            return await get_veto_session(session, encounter.id)
    else:
        await session.flush()
    return veto


async def reset_veto_session(
    session: AsyncSession,
    encounter: models.Encounter,
    *,
    commit: bool = True,
) -> models.EncounterVetoSession | None:
    """Drop the encounter's veto session + pool rows and re-create them.

    Re-resolves config and seeds from scratch; returns the new session (or
    None when it can no longer be created — teams unknown / not configured).
    """
    await session.execute(
        sa.delete(models.EncounterVetoSession).where(models.EncounterVetoSession.encounter_id == encounter.id)
    )
    await session.execute(
        sa.delete(models.EncounterMapPool).where(models.EncounterMapPool.encounter_id == encounter.id)
    )
    await session.flush()
    # Signal even when the re-ensure no-ops: the room just lost its session.
    register_map_veto_realtime_update(session, encounter.id)
    veto = await ensure_veto_session(session, encounter, commit=False)
    if commit:
        await session.commit()
    return veto


async def sync_veto_session_after_team_change(
    session: AsyncSession,
    encounter: models.Encounter,
) -> None:
    """Team-assignment hook (bracket propagation / admin encounter edits).

    Called after an encounter's home/away team ids changed. Both teams now
    set with no session -> ensure one. Session already exists -> the snapshot
    is stale, reset it — UNLESS a pool entry is already ``played`` (the match
    is underway; an admin resets manually). Runs inside the caller's
    transaction (no commit).
    """
    veto = await get_veto_session(session, encounter.id)
    if veto is None:
        if encounter.home_team_id is not None and encounter.away_team_id is not None:
            await ensure_veto_session(session, encounter, commit=False)
        return
    played_count = await session.scalar(
        select(sa.func.count())
        .select_from(models.EncounterMapPool)
        .where(
            models.EncounterMapPool.encounter_id == encounter.id,
            models.EncounterMapPool.status == MapPoolEntryStatus.PLAYED,
        )
    )
    if played_count:
        return
    await reset_veto_session(session, encounter, commit=False)
