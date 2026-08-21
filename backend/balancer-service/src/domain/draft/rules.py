"""Pure draft business rules: validation, seat ordering, registration mapping,
pick-slot resolution, role-edit validation. No database access, no async.

Consolidated from what used to be the top halves of ``services/draft/
{lifecycle,selection,role_edit}.py`` — each of those files now holds only its
service class; every rule usable without a session lives here.
"""

from __future__ import annotations

from collections.abc import Collection, Mapping, Sequence
from datetime import datetime, timedelta
from typing import Final, Protocol, TypeVar

from shared.core.enums import (
    HERO_TYPE_CLASSES,
    DraftCaptainOrder,
    DraftFormat,
    DraftPickStatus,
    DraftPlayerStatus,
    DraftStatus,
    HeroClass,
)
from shared.core.errors import ApiHTTPException
from shared.domain.roster_shape import FLEX_SLOT_CODE, RosterShape
from shared.models.balancer.draft import (
    DraftPick,
    DraftPlayer,
    DraftPlayerRole,
    DraftPlayerRoleHero,
    DraftSession,
    DraftTeam,
)
from shared.models.registration.registration import BalancerRegistration, BalancerRegistrationForm
from src.domain.draft.entities import (
    REGISTRATION_CUSTOM_FIELDS_KEY,
    DraftFeasibilityReport,
    DraftFeasibilityState,
    DraftResult,
    DraftSnapshot,
    EligiblePlayer,
    RoleEditPreview,
    SlotDecision,
)
from src.domain.draft.errors import err as _err
from src.domain.draft.feasibility import analyze_draft_feasibility, describe_role_deficits

__all__ = (
    "DELETABLE_STATUSES",
    "DYNAMIC_ROUND_RULES",
    "all_roles_required",
    "arm_clock",
    "available_player_from",
    "average_seat_order",
    "bump_seed_version",
    "is_on_clock_captain",
    "map_registration",
    "mark_role_shortage_paused",
    "order_captain_ids",
    "playable_roles",
    "preview_role_addition",
    "registration_additional_info",
    "registration_auth_user_id",
    "registration_player_id",
    "resolve_pick_slot",
    "role_is_legal",
    "role_openings",
    "role_shortage_error",
    "round_seat_order",
    "seed_hero_rows",
    "seed_role_rows",
    "team_slot_counts",
    "unsafe_pick_error",
    "validate_current_pick",
    "validate_draft_rounds",
    "validate_role_edit_request",
    "validate_seed_version",
)

# Every other status is erasable; a LIVE/PAUSED draft has captains on a clock
# and must be cancelled first (services/draft/lifecycle.py::delete_session).
DELETABLE_STATUSES = (
    DraftStatus.SETUP.value,
    DraftStatus.READY.value,
    DraftStatus.COMPLETED.value,
    DraftStatus.CANCELLED.value,
)


# --- lifecycle / seeding -----------------------------------------------------


def validate_draft_rounds(*, rounds: int, shape: RosterShape) -> None:
    """A draft has exactly one pick per roster slot the captain does not fill."""
    if rounds != shape.draft_rounds:
        raise _err(
            "invalid_roster_shape",
            f"rounds must be {shape.draft_rounds}: the roster shape {shape.slots} has "
            f"{shape.team_size} slots and the captain already fills one",
            status_code=422,
        )


def validate_seed_version(draft_session: DraftSession, *, expected_version: int | None) -> None:
    if expected_version is not None and draft_session.version != expected_version:
        raise _err("draft_session_stale", "Draft setup changed; reload the seed preview", status_code=409)


def bump_seed_version(draft_session: DraftSession) -> None:
    draft_session.version = (draft_session.version or 0) + 1


def role_shortage_error(report: DraftFeasibilityReport) -> ApiHTTPException:
    details = describe_role_deficits(report)
    message = "Draft pool cannot fill every team role"
    if details:
        message = f"{message}: {details}"
    return _err("role_shortage", message, status_code=422)


def seed_hero_rows(entries: list[dict] | None) -> list[DraftPlayerRoleHero]:
    """Top-hero rows for a role, from ``{hero_id, slug, image_path}`` seed dicts.

    Only entries carrying a resolved ``hero_id`` become rows (the child table has
    a real FK to ``overwatch.hero``); slug-only manual entries are skipped.
    """
    rows: list[DraftPlayerRoleHero] = []
    for priority, entry in enumerate(entries or []):
        hero_id = entry.get("hero_id") if isinstance(entry, dict) else None
        if hero_id is not None:
            rows.append(DraftPlayerRoleHero(hero_id=hero_id, priority=priority))
    return rows


def seed_role_rows(
    primary_role: HeroClass | str,
    secondary_roles: list[HeroClass] | None,
    role_ranks: dict | None,
    role_top_heroes: dict | None,
) -> list[DraftPlayerRole]:
    """Normalized ``DraftPlayerRole`` rows for a seeded player/captain.

    The role set is the UNION of the primary role, the declared secondaries, and
    any roles that only carry a rank or top-heroes. ``is_secondary`` reflects
    membership in ``secondary_roles`` (so a captain with a multi-role rank
    catalogue but no declared secondaries yields ``secondary_roles_json`` -> None,
    exactly as the old JSON writer did). ``rank_value`` is taken per role from
    ``role_ranks`` (absent -> NULL).
    """
    role_ranks = role_ranks or {}
    role_top_heroes = role_top_heroes or {}
    primary_value = primary_role.slot_code if isinstance(primary_role, HeroClass) else str(primary_role)
    secondary_values = [r.slot_code if isinstance(r, HeroClass) else str(r) for r in (secondary_roles or [])]
    secondary_set = set(secondary_values)

    ordered: list[str] = [primary_value]
    for value in (*secondary_values, *role_ranks.keys(), *role_top_heroes.keys()):
        if value not in ordered:
            ordered.append(value)

    return [
        DraftPlayerRole(
            role=role,
            rank_value=role_ranks.get(role),
            is_secondary=role in secondary_set,
            priority=priority,
            hero_entries=seed_hero_rows(role_top_heroes.get(role)),
        )
        for priority, role in enumerate(ordered)
    ]


# Round rules whose seat order is only known once the round starts: they rank
# teams by their live average, so seeding and any later resync leave the linear
# order in place and ``DraftSelectionService._apply_dynamic_round_order``
# re-seats the round on its first pick.
DYNAMIC_ROUND_RULES: Final[tuple[str, ...]] = ("team_avg_asc", "team_avg_desc")


class _Seat(Protocol):
    """What seat ordering reads off a team: its id and its seed position."""

    id: int
    draft_position: int


_SeatT = TypeVar("_SeatT", bound=_Seat)


def round_seat_order(
    seats: Sequence[_SeatT],
    *,
    fmt: DraftFormat,
    round_rules: Sequence[str | None],
    round_idx: int,
    captain_ranks: Mapping[int, int],
) -> list[_SeatT]:
    """Seat order for one round: who picks first, second, ... in it.

    ``seats`` is the seed order (position 1 first) and ``round_idx`` is 0-based.
    The single source of truth for what a rule MEANS, shared by seeding and
    ``DraftLifecycleService.resync_pick_order`` -- the two used to hold separate
    copies, which is how a rule changed after seeding could mean one thing in
    the wizard preview and another on the board.
    """
    if fmt == DraftFormat.SNAKE:
        return list(reversed(seats)) if round_idx % 2 == 1 else list(seats)
    if fmt != DraftFormat.CUSTOM:
        return list(seats)

    rule = round_rules[round_idx] if round_idx < len(round_rules) else None
    if rule == "reverse":
        return list(reversed(seats))
    if rule == "weakest_first":
        return sorted(seats, key=lambda t: (captain_ranks.get(t.id, -1), t.draft_position))
    if rule == "strongest_first":
        return sorted(seats, key=lambda t: (captain_ranks.get(t.id, -1), -t.draft_position), reverse=True)
    # "linear", a dynamic rule, an unknown value, or a hole left by an older
    # client: all keep the seed order here.
    return list(seats)


def average_seat_order(
    seats: Sequence[_SeatT],
    *,
    averages: Mapping[int, float],
    descending: bool,
) -> list[_SeatT]:
    """Seat order for a ``team_avg_*`` round: by live average, ties by seed.

    The direction lives in the key rather than in ``reverse=``, because
    ``reverse`` flips the WHOLE key: the tie-break would run backwards under
    ``team_avg_desc`` and forwards under ``team_avg_asc``, so two teams on the
    same average would swap seats purely from the direction of the rule. Equal
    averages therefore always fall back to the seed order, matching what
    ``weakest_first``/``strongest_first`` already do with equal captain ranks.

    A team with no average yet sorts as 0.0. In practice every team has one --
    captains are seeded as PICKED players on their own roster -- so this only
    guards a team whose roster was emptied by hand.
    """
    return sorted(
        seats,
        key=lambda t: (
            -averages.get(t.id, 0.0) if descending else averages.get(t.id, 0.0),
            t.draft_position,
        ),
    )


def _to_draft_role(role: str | None) -> HeroClass | None:
    """Parse a registration role string; ``flex`` is not a playable role here."""
    parsed = HeroClass.parse(role)
    return parsed if parsed is not HeroClass.flex else None


def registration_auth_user_id(reg: BalancerRegistration) -> int | None:
    """Resolve the registering account's auth identity for a pool registration.

    ``BalancerRegistration`` no longer carries ``auth_user_id`` directly —
    identity resolves through ``workspace_member.player.auth_user_id``.
    """
    member = reg.workspace_member
    if member is None or member.player is None:
        return None
    return member.player.auth_user_id


def registration_player_id(reg: BalancerRegistration) -> int | None:
    """The registration's domain player id (players.user.id) via its member.

    ``workspace_member_id`` is the row's only identity anchor (dbarch02 dropped
    ``user_id``); the caller eager-loads the relationship, so this never
    lazy-loads.
    """
    member = reg.workspace_member
    return member.player_id if member is not None else None


def all_roles_required(form: BalancerRegistrationForm | None) -> bool:
    """Whether the tournament makes every role playable by everyone.

    True for ``flex_role.mode`` in ``("all_roles", "forced")``. Mirror of
    ``tournament-service`` ``registration/_common.all_roles_required``: the two
    live in different services with no shared module between them, so the
    contract is pinned by ``tests/test_draft_forced_flex.py`` and the parity
    fixtures.

    ``all_roles`` still lets the registrant name a priority role, so ``is_flex``
    stays false for them and their non-priority roles keep carrying discomfort.
    Only the max-rank policy is shared between the two modes, and it is shared
    because eligibility demands it: the balancer needs a rating for every role.

    Reads fail closed — an unreadable form is optional.
    """
    if form is None:
        return False
    config = (getattr(form, "built_in_fields_json", None) or {}).get("flex_role")
    if not isinstance(config, dict):
        return False
    if config.get("enabled", True) is False:
        return False
    return config.get("mode") in ("all_roles", "forced")


def registration_additional_info(reg: BalancerRegistration) -> dict:
    """The per-player catch-all bag seeded from a registration.

    ``notes`` stays public (captains read it while drafting). The registration's
    custom-field ANSWERS are copied wholesale under a private key: which of them
    a spectator may see is decided per field by the organizer
    (``registration_form.custom_fields_json[*].show_in_draft``) and resolved on
    the read side, so toggling a field takes effect on an already-seeded draft
    instead of demanding a re-seed. ``services/draft/board.py``'s
    ``public_additional_info`` strips the raw bag from the public snapshot.
    """
    info: dict = {}
    if reg.notes:
        info["notes"] = reg.notes
    answers = getattr(reg, "custom_fields_json", None) or {}
    if answers:
        info[REGISTRATION_CUSTOM_FIELDS_KEY] = dict(answers)
    return info


def map_registration(reg: BalancerRegistration, *, all_roles: bool = False) -> dict:
    """Derive draft role/rank fields from a tournament registration's roles.

    The registration-based pool is the balancer source of truth (3NF). Active
    role rows sorted by priority -> primary (preferring is_primary) + secondaries;
    rank/sub-role come from the primary role.

    Under ``all_roles`` role stops being a constraint: every role is playable and
    the player's *strength* -- ``rank_value`` -- is the maximum rank across all
    their roles. Their per-role catalogue still says what they are actually rated
    at on each role, because the draft SHOWS it: a captain picking a role reads
    that number, and stamping the maximum onto all three turned the role chooser
    into one number printed three times. Roles the registration never ranked take
    the maximum instead of nothing, so every playable role still carries a rating
    (the balancer's eligibility for a role is the presence of one). The
    ``is_active`` filter is deliberately bypassed there -- a Google-Sheets row
    whose rank did not parse arrives with ``is_active=False`` and would
    otherwise silently lose a playable role.
    """
    entries = sorted((reg.roles or []), key=lambda r: r.priority)
    active = entries if all_roles else [r for r in entries if r.is_active]
    roles: list[HeroClass] = []
    for r in active:
        role = _to_draft_role(r.role)
        if role is not None and role not in roles:
            roles.append(role)
    primary_entry = next((r for r in active if r.is_primary and _to_draft_role(r.role)), None)
    if primary_entry is None and active:
        primary_entry = active[0]
    primary = (_to_draft_role(primary_entry.role) if primary_entry else None) or (roles[0] if roles else HeroClass.damage)
    if all_roles:
        roles = [primary, *(role for role in HERO_TYPE_CLASSES if role != primary)]
    secondary = [r for r in roles if r != primary]
    ranks = [r.rank_value for r in active if r.rank_value is not None]
    effective_rank = max(ranks) if ranks else None
    if all_roles:
        rank_value = effective_rank
    else:
        rank_value = (primary_entry.rank_value if primary_entry else None) or effective_rank
    sub_role = primary_entry.subrole if primary_entry else None

    # Per-role rank catalogue and top heroes, keyed by role.slot_code, promoted to
    # dedicated typed fields (no more burying them in an "anomaly_flags" bag).
    role_ranks: dict[str, int] = {}
    role_top_heroes: dict[str, list[dict]] = {}
    for r in active:
        role = _to_draft_role(r.role)
        if role is None:
            continue
        if r.rank_value is not None:
            role_ranks[role.slot_code] = r.rank_value
        hero_entries = getattr(r, "hero_entries", None)
        heroes = (
            [
                {
                    # hero_id is what the normalized draft_player_role_hero row needs
                    # (real FK); slug/image_path are kept for the read-side snapshot.
                    "hero_id": getattr(he.hero, "id", None),
                    "slug": getattr(he.hero, "slug", ""),
                    "image_path": getattr(he.hero, "image_path", None),
                }
                for he in (hero_entries or [])
                if he and getattr(he, "hero", None) is not None
            ]
            if isinstance(hero_entries, (list, set))
            else []
        )
        if heroes:
            role_top_heroes[role.slot_code] = heroes

    if all_roles:
        # Every role rated, none overwritten. Keyed off HERO_TYPE_CLASSES rather
        # than the rows so a registration written before the mode was switched on
        # (fewer than three role rows) still comes out fully playable.
        role_ranks = (
            {}
            if effective_rank is None
            else {role.slot_code: role_ranks.get(role.slot_code, effective_rank) for role in HERO_TYPE_CLASSES}
        )

    return {
        "primary_role": primary,
        "secondary_roles": secondary,
        "sub_role": sub_role,
        "rank_value": rank_value,
        "division_number": None,
        "is_flex": bool(reg.is_flex_computed),
        "role_ranks": role_ranks,
        "role_top_heroes": role_top_heroes,
        "additional_info": registration_additional_info(reg),
    }


def order_captain_ids(
    entries: list[tuple[int, int | None]],
    strategy: DraftCaptainOrder,
    seed: int | None = None,
) -> list[int]:
    """Return captain ids in seat order (position 1 picks first).

    ``entries`` are (id, rank_value) in selection order. WEAKEST_FIRST sorts by
    ascending rank (unknown rank treated as weakest), STRONGEST_FIRST descending,
    RANDOM is a deterministic shuffle, MANUAL keeps selection order. Ties break by
    id for full determinism.
    """
    if strategy == DraftCaptainOrder.MANUAL:
        return [rid for rid, _ in entries]
    if strategy == DraftCaptainOrder.WEAKEST_FIRST:
        ordered = sorted(entries, key=lambda e: (e[1] if e[1] is not None else -1, e[0]))
        return [rid for rid, _ in ordered]
    if strategy == DraftCaptainOrder.STRONGEST_FIRST:
        ordered = sorted(entries, key=lambda e: (-(e[1] if e[1] is not None else -1), e[0]))
        return [rid for rid, _ in ordered]
    # RANDOM: deterministic Mulberry32 shuffle keyed by seed, so a preview and its
    # commit (same seed) always agree on the order.
    rng_seed = seed if seed is not None else 0
    state = rng_seed & 0xFFFFFFFF

    def _next() -> float:
        nonlocal state
        state = (state + 0x6D2B79F5) & 0xFFFFFFFF
        t = state
        t = ((t ^ (t >> 15)) * (t | 1)) & 0xFFFFFFFF
        t = (t ^ (t + (((t ^ (t >> 7)) * (t | 61)) & 0xFFFFFFFF))) & 0xFFFFFFFF
        return ((t ^ (t >> 14)) & 0xFFFFFFFF) / 4294967296.0

    ordered = [rid for rid, _ in entries]
    for i in range(len(ordered) - 1, 0, -1):
        j = int(_next() * (i + 1))
        ordered[i], ordered[j] = ordered[j], ordered[i]
    return ordered


def arm_clock(pick: DraftPick, pick_time_seconds: int, now: datetime) -> None:
    pick.status = DraftPickStatus.ON_CLOCK.value
    pick.clock_started_at = now
    pick.clock_expires_at = now + timedelta(seconds=pick_time_seconds)
    pick.clock_remaining_ms = None


# --- pick selection -----------------------------------------------------------


def team_slot_counts(
    players: Collection[DraftPlayer],
    picks: Collection[DraftPick],
    team_id: int,
    shape: RosterShape,
) -> dict[str, int]:
    """Filled-slot counts for one team, computed from the request snapshot.

    Role slots are filled by the drafted role -- a resolved pick's frozen
    ``target_role`` wins over the player's ``primary_role``, so off-role picks
    count against the drafted role. Every remaining picked player occupies a flex
    slot: a role slot that is already full, a role the shape has no slot for, and
    a player with no usable role all land there, which is exactly the spill rule
    ``feasibility._remaining_capacity`` applies to the same rows.
    """
    pick_by_player_id = {
        pk.picked_player_id: pk
        for pk in picks
        if pk.picked_player_id is not None
        and pk.draft_team_id == team_id
        and pk.status in (DraftPickStatus.COMPLETED.value, DraftPickStatus.AUTOPICKED.value)
    }
    role_slot_targets = shape.role_slots
    counts = dict.fromkeys(shape.slots, 0)
    taken = 0
    for p in players:
        if p.drafted_by_team_id != team_id or p.status != DraftPlayerStatus.PICKED.value:
            continue
        taken += 1
        pk = pick_by_player_id.get(p.id)
        code = pk.target_role if (pk and pk.target_role) else p.primary_role
        if code in role_slot_targets and counts[code] < role_slot_targets[code]:
            counts[code] += 1
    if FLEX_SLOT_CODE in counts:
        counts[FLEX_SLOT_CODE] = min(
            shape.flex_slots,
            max(0, taken - sum(counts[code] for code in role_slot_targets)),
        )
    return counts


def role_openings(shape: RosterShape, counts: Mapping[str, int]) -> dict[HeroClass, int]:
    """How many more slots each role can still take on this team.

    A role lands either in its own remaining role slot or in any free flex slot,
    so the two capacities add up. ``fit`` only asks whether a role is still open
    and the ``slot_filled`` guard only asks whether it is zero, so one number
    serves both.
    """
    targets = shape.slots
    free_flex = max(0, targets.get(FLEX_SLOT_CODE, 0) - counts.get(FLEX_SLOT_CODE, 0))
    return {role: max(0, targets.get(role.slot_code, 0) - counts.get(role.slot_code, 0)) + free_flex for role in HERO_TYPE_CLASSES}


def validate_current_pick(draft_session: DraftSession, pick: DraftPick) -> None:
    if draft_session.status != DraftStatus.LIVE.value:
        raise _err("draft_not_live", "Draft is not live")
    if pick.id != draft_session.current_pick_id or pick.status != DraftPickStatus.ON_CLOCK.value:
        raise _err("pick_not_on_clock", "This is not the current on-clock pick")


def available_player_from(snapshot: DraftSnapshot, player_id: int) -> DraftPlayer:
    # Snapshot players were loaded with loaders.player_options(), so the compat
    # read properties (secondary_roles_json/role_ranks via role_is_legal +
    # ranks.role_rank) never trigger an async lazy load.
    player = next((p for p in snapshot.players if p.id == player_id), None)
    if player is None:
        raise _err("player_not_found", "Player not in this draft", status_code=404)
    if player.status != DraftPlayerStatus.AVAILABLE.value:
        raise _err("player_unavailable", "Player is not available")
    return player


def role_is_legal(player: DraftPlayer, target_role: HeroClass | None) -> bool:
    if target_role is None:
        return True
    if player.is_flex:
        return True
    playable = {player.primary_role, *(player.secondary_roles_json or [])}
    return target_role.slot_code in playable


def playable_roles(player: DraftPlayer) -> frozenset[HeroClass]:
    if player.is_flex:
        return frozenset(HERO_TYPE_CLASSES)
    return frozenset(HeroClass.from_slot_code(role) for role in {player.primary_role, *(player.secondary_roles_json or [])})


def resolve_pick_slot(
    shape: RosterShape,
    counts: Mapping[str, int],
    player: DraftPlayer,
    target_role: HeroClass | None,
) -> SlotDecision:
    """Validate one pick against the shape and this team's already filled slots.

    Shared by select, autopick and override so the three cannot drift. Raises
    ``illegal_role`` when the player cannot play the requested role, and
    ``slot_filled`` when neither a matching role slot nor a flex slot is left.
    """
    # A role-less roster has no role to validate against, so a requested role
    # carries no meaning: drop it instead of rejecting the request.
    requested = target_role if shape.has_role_slots else None
    if not role_is_legal(player, requested):
        raise _err("illegal_role", "Player cannot play the requested role", status_code=422)
    role = requested or HeroClass.from_slot_code(player.primary_role)
    if role_openings(shape, counts).get(role, 0) <= 0:
        raise _err(
            "slot_filled",
            f"No roster slot left for {role.slot_code} on this team",
            status_code=422,
        )
    return SlotDecision(role=role, recorded_role=role.slot_code if shape.has_role_slots else None)


def unsafe_pick_error(report: DraftFeasibilityReport) -> ApiHTTPException:
    details = describe_role_deficits(report) or "unknown role deficit"
    return _err(
        "pick_makes_draft_infeasible",
        f"This pick would leave unfillable role slots: {details}",
        status_code=422,
    )


def mark_role_shortage_paused(draft_session: DraftSession, pick: DraftPick) -> DraftResult:
    """Pause on the unresolved current pick when no globally safe option exists."""

    draft_session.status = DraftStatus.PAUSED.value
    draft_session.blocked_reason = "role_shortage"
    pick.clock_expires_at = None
    pick.clock_remaining_ms = 0
    return DraftResult(
        pick=pick,
        next_pick=None,
        completed=False,
        blocked_reason="role_shortage",
    )


def is_on_clock_captain(
    team: DraftTeam | None,
    *,
    actor_auth_user_id: int | None,
    actor_player_ids: Collection[int],
) -> bool:
    if team is None:
        return False
    if actor_auth_user_id is not None and team.captain_auth_user_id == actor_auth_user_id:
        return True
    return team.captain_user_id is not None and team.captain_user_id in actor_player_ids


# --- role edits ---------------------------------------------------------------

_EDITABLE_STATUSES = {
    DraftStatus.SETUP.value,
    DraftStatus.READY.value,
    DraftStatus.PAUSED.value,
}


def validate_role_edit_request(
    draft_session: DraftSession,
    player: DraftPlayer,
    *,
    role: HeroClass,
    rank_value: int | None,
    rank_absence_confirmed: bool,
    reason: str,
    expected_version: int,
) -> str:
    """Validate both preview and commit; return the normalized private reason."""

    if draft_session.status not in _EDITABLE_STATUSES:
        raise _err("role_edit_requires_pause", "Pause the draft before editing a player role", status_code=409)
    if player.session_id != draft_session.id:
        raise _err("player_not_found", "Player is not in this draft session", status_code=404)
    if player.status != DraftPlayerStatus.AVAILABLE.value:
        raise _err("player_not_available", "Only a remaining available player can receive an emergency role")
    if player.version != expected_version:
        raise _err("draft_player_stale", "Player snapshot changed; reload the role-edit preview", status_code=409)
    if any(entry.role == role.slot_code for entry in player.roles):
        raise _err("role_already_exists", f"Player already has the {role.slot_code} role", status_code=409)
    normalized_reason = reason.strip()
    if not normalized_reason:
        raise _err("role_edit_reason_required", "A private audit reason is required")
    if rank_value is None and not rank_absence_confirmed:
        raise _err(
            "role_rank_confirmation_required",
            "Provide a role rank or explicitly confirm that it is unavailable",
        )
    return normalized_reason


def preview_role_addition(
    state: DraftFeasibilityState,
    *,
    player_id: int,
    role: HeroClass,
) -> RoleEditPreview:
    before = analyze_draft_feasibility(
        team_ids=state.team_ids,
        slot_targets=state.slot_targets,
        players=state.players,
        assignments=state.assignments,
    )
    found = False
    updated_players: list[EligiblePlayer] = []
    for player in state.players:
        if player.player_id == player_id:
            found = True
            updated_players.append(
                EligiblePlayer(
                    player_id=player.player_id,
                    playable_roles=player.playable_roles | {role},
                )
            )
        else:
            updated_players.append(player)
    if not found:
        raise _err("player_not_available", "Player is not available in the remaining draft pool", status_code=404)
    after = analyze_draft_feasibility(
        team_ids=state.team_ids,
        slot_targets=state.slot_targets,
        players=tuple(updated_players),
        assignments=state.assignments,
    )
    return RoleEditPreview(before=before, after=after)
