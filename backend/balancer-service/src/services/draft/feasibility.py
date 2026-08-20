"""Pure slot-feasibility rules for live draft sessions.

A draft is feasible when every still-open ``(team, slot)`` roster slot can be
matched to a distinct available player who fits it.  A role slot fits a player
who declared that role; a ``flex`` slot fits anybody.  Evaluating a hypothetical
pick removes both the chosen slot and player before matching, which prevents a
locally legal pick from starving another team's future roster slot.
"""

from __future__ import annotations

import asyncio
from collections import Counter
from collections.abc import Collection, Mapping
from dataclasses import dataclass
from typing import Any

import sqlalchemy as sa
from sqlalchemy.ext.asyncio import AsyncSession

from shared.core.enums import HERO_TYPE_CLASSES, DraftPickStatus, DraftPlayerStatus, HeroClass
from shared.domain.roster_shape import FLEX_SLOT_CODE, ROSTER_SLOT_CODES, RosterShape
from shared.models.balancer.draft import DraftPick, DraftPlayer, DraftSession, DraftTeam
from shared.services.roster_shape_access import get_effective_roster_shape
from src.services.draft import loaders
from src.services.role_matching import maximum_bipartite_matching


@dataclass(frozen=True)
class EligiblePlayer:
    player_id: int
    playable_roles: frozenset[HeroClass]


@dataclass(frozen=True)
class DraftAssignment:
    player_id: int
    team_id: int
    # A roster slot code, so ``flex`` is expressible; see _remaining_capacity for
    # how a role code that no longer has room falls back to a free flex slot.
    slot_code: str


@dataclass(frozen=True)
class DraftSlot:
    team_id: int
    slot_code: str
    ordinal: int


@dataclass(frozen=True)
class SlotDeficit:
    slot_code: str
    unmatched_slots: int
    eligible_players: int


@dataclass(frozen=True)
class DraftFeasibilityReport:
    is_feasible: bool
    total_open_slots: int
    matched_slots: int
    unmatched_slots: tuple[DraftSlot, ...]
    slot_deficits: tuple[SlotDeficit, ...]
    blocking_player_ids: tuple[int, ...]
    reason_code: str | None = None


@dataclass(frozen=True)
class DraftPickOption:
    player_id: int
    role: HeroClass
    is_safe: bool
    reason_code: str | None
    unmatched_slots: tuple[DraftSlot, ...] = ()
    blocking_player_ids: tuple[int, ...] = ()


@dataclass(frozen=True)
class DraftFeasibilityState:
    team_ids: tuple[int, ...]
    slot_targets: dict[str, int]
    players: tuple[EligiblePlayer, ...]
    assignments: tuple[DraftAssignment, ...]


def _as_role(value: Any) -> HeroClass | None:
    """Parse a role slot code; ``flex`` is not a playable role (see ``is_flex``)."""
    role = HeroClass.parse(value)
    return role if role is not HeroClass.flex else None


def build_feasibility_state(
    *,
    shape: RosterShape,
    teams: Collection[DraftTeam],
    players: Collection[DraftPlayer],
    picks: Collection[DraftPick],
) -> DraftFeasibilityState:
    """Translate eager-loaded ORM snapshot rows into the pure matching input."""

    team_ids = tuple(team.id for team in sorted(teams, key=lambda team: (team.draft_position, team.id)))
    picked_role_by_player = {
        pick.picked_player_id: role
        for pick in picks
        if pick.picked_player_id is not None
        and pick.status
        in {
            DraftPickStatus.COMPLETED.value,
            DraftPickStatus.AUTOPICKED.value,
        }
        and (role := _as_role(pick.target_role)) is not None
    }
    eligible_players: list[EligiblePlayer] = []
    assignments: list[DraftAssignment] = []
    for player in players:
        primary_role = _as_role(player.primary_role)
        if player.status == DraftPlayerStatus.AVAILABLE.value:
            playable_roles = (
                frozenset(HERO_TYPE_CLASSES)
                if player.is_flex
                else frozenset(role for entry in player.roles if (role := _as_role(entry.role)) is not None)
            )
            if primary_role is not None:
                playable_roles = playable_roles | {primary_role}
            eligible_players.append(EligiblePlayer(player_id=player.id, playable_roles=playable_roles))
            continue
        if player.status != DraftPlayerStatus.PICKED.value or player.drafted_by_team_id is None:
            continue
        # Which slot a picked player occupies: on a role-less roster there is only
        # flex, so every pick lands there and a missing role is no longer a reason
        # to skip the player. Otherwise the drafted role names the slot, and the
        # "role slot already full -> spill into flex" rule lives in
        # _remaining_capacity, where the per-team counters already exist, instead
        # of being recomputed here and again for every hypothetical pick.
        if not shape.has_role_slots:
            assignments.append(
                DraftAssignment(
                    player_id=player.id,
                    team_id=player.drafted_by_team_id,
                    slot_code=FLEX_SLOT_CODE,
                )
            )
            continue
        assigned_role = picked_role_by_player.get(player.id) or primary_role
        if assigned_role is not None:
            assignments.append(
                DraftAssignment(
                    player_id=player.id,
                    team_id=player.drafted_by_team_id,
                    slot_code=assigned_role.slot_code,
                )
            )
    return DraftFeasibilityState(
        team_ids=team_ids,
        slot_targets=shape.slots,
        players=tuple(eligible_players),
        assignments=tuple(assignments),
    )


@dataclass(frozen=True)
class DraftSnapshot:
    """One consistent read of a session's team/player/pick rows.

    Loaded once per request and shared by every step that needs the session
    contents (role counts, fit construction, feasibility state) instead of
    each step re-querying the same rows.
    """

    teams: tuple[DraftTeam, ...]
    players: tuple[DraftPlayer, ...]
    picks: tuple[DraftPick, ...]


async def load_snapshot(session: AsyncSession, draft_session: DraftSession) -> DraftSnapshot:
    """Load the session's rows once; players carry the eager-load option set."""
    teams = (
        await session.scalars(
            sa.select(DraftTeam)
            .where(DraftTeam.session_id == draft_session.id)
            .order_by(DraftTeam.draft_position.asc())
        )
    ).all()
    players = (
        await session.scalars(
            sa.select(DraftPlayer).where(DraftPlayer.session_id == draft_session.id).options(*loaders.player_options())
        )
    ).all()
    picks = (await session.scalars(sa.select(DraftPick).where(DraftPick.session_id == draft_session.id))).all()
    return DraftSnapshot(teams=tuple(teams), players=tuple(players), picks=tuple(picks))


async def resolve_shape(session: AsyncSession, draft_session: DraftSession) -> RosterShape:
    """The roster shape this draft's teams must fill.

    The single place that knows which ids a draft resolves its shape from, so
    callers never re-derive the tournament/workspace precedence.  Both levels are
    cache-backed, so calling this per request step is cheap.
    """
    return await get_effective_roster_shape(
        session,
        tournament_id=draft_session.tournament_id,
        workspace_id=draft_session.workspace_id,
    )


async def state_from_snapshot(
    session: AsyncSession,
    draft_session: DraftSession,
    snapshot: DraftSnapshot,
) -> DraftFeasibilityState:
    """Translate an already-loaded snapshot into the matching input."""
    return build_feasibility_state(
        shape=await resolve_shape(session, draft_session),
        teams=snapshot.teams,
        players=snapshot.players,
        picks=snapshot.picks,
    )


async def load_feasibility_state(
    session: AsyncSession,
    draft_session: DraftSession,
) -> DraftFeasibilityState:
    return await state_from_snapshot(session, draft_session, await load_snapshot(session, draft_session))


async def analyze_session(
    session: AsyncSession,
    draft_session: DraftSession,
    *,
    hypothetical: DraftAssignment | None = None,
    state: DraftFeasibilityState | None = None,
) -> DraftFeasibilityReport:
    if state is None:
        state = await load_feasibility_state(session, draft_session)
    # The bipartite matching is pure CPU; run it off the event loop.
    return await asyncio.to_thread(
        analyze_draft_feasibility,
        team_ids=state.team_ids,
        slot_targets=state.slot_targets,
        players=state.players,
        assignments=state.assignments,
        hypothetical=hypothetical,
    )


async def evaluate_session_pick_options(
    session: AsyncSession,
    draft_session: DraftSession,
    *,
    team_id: int,
    state: DraftFeasibilityState | None = None,
) -> tuple[DraftPickOption, ...]:
    if state is None:
        state = await load_feasibility_state(session, draft_session)
    # Up to 21 forced-pick matchings (see evaluate_pick_options) — pure CPU,
    # run them off the event loop.
    return await asyncio.to_thread(
        evaluate_pick_options,
        team_id=team_id,
        team_ids=state.team_ids,
        slot_targets=state.slot_targets,
        players=state.players,
        assignments=state.assignments,
    )


def _ordered_slot_codes(slot_targets: Mapping[str, int]) -> tuple[str, ...]:
    return tuple(code for code in ROSTER_SLOT_CODES if slot_targets.get(code, 0) > 0)


def _slot_fits(player: EligiblePlayer, slot_code: str) -> bool:
    """The one new rule of the slot vocabulary: flex takes anybody."""
    if slot_code == FLEX_SLOT_CODE:
        return True
    role = _as_role(slot_code)
    return role is not None and role in player.playable_roles


def describe_role_deficits(report: DraftFeasibilityReport) -> str:
    """Return a safe, compact explanation suitable for API errors."""

    return ", ".join(
        f"{deficit.slot_code}: {deficit.unmatched_slots} open, {deficit.eligible_players} eligible"
        for deficit in report.slot_deficits
    )


def _remaining_capacity(
    *,
    team_ids: Collection[int],
    slot_targets: Mapping[str, int],
    assignments: Collection[DraftAssignment],
) -> tuple[dict[tuple[int, str], int], bool]:
    remaining = {
        (team_id, code): int(slot_targets.get(code, 0))
        for team_id in dict.fromkeys(team_ids)
        for code in _ordered_slot_codes(slot_targets)
    }
    overfilled = False
    for assignment in assignments:
        key = (assignment.team_id, assignment.slot_code)
        if remaining.get(key, 0) > 0:
            remaining[key] -= 1
            continue
        # A role slot with no room left spills into a free flex slot: flex accepts
        # anybody, so an extra tank on a {tank: 1, flex: 5} roster is a legal flex
        # pick, not an overfill. Doing it here keeps the rule in one place for
        # already-resolved picks and hypothetical ones alike. Only when neither the
        # named slot nor flex has room is the roster genuinely overfilled.
        flex_key = (assignment.team_id, FLEX_SLOT_CODE)
        if assignment.slot_code != FLEX_SLOT_CODE and remaining.get(flex_key, 0) > 0:
            remaining[flex_key] -= 1
            continue
        overfilled = True
    return remaining, overfilled


def _open_slots(remaining: Mapping[tuple[int, str], int]) -> tuple[DraftSlot, ...]:
    return tuple(
        DraftSlot(team_id=team_id, slot_code=code, ordinal=ordinal)
        for (team_id, code), count in remaining.items()
        for ordinal in range(count)
    )


def analyze_draft_feasibility(
    *,
    team_ids: Collection[int],
    slot_targets: Mapping[str, int],
    players: Collection[EligiblePlayer],
    assignments: Collection[DraftAssignment] = (),
    hypothetical: DraftAssignment | None = None,
) -> DraftFeasibilityReport:
    """Analyze the remaining draft, optionally after one hypothetical pick."""

    all_assignments = (*assignments, *((hypothetical,) if hypothetical is not None else ()))
    remaining, overfilled = _remaining_capacity(
        team_ids=team_ids,
        slot_targets=slot_targets,
        assignments=all_assignments,
    )
    slots = _open_slots(remaining)
    assigned_player_ids = {assignment.player_id for assignment in all_assignments}
    available_players = tuple(player for player in players if player.player_id not in assigned_player_ids)
    slots_by_code = {
        code: tuple(slot for slot in slots if slot.slot_code == code) for code in _ordered_slot_codes(slot_targets)
    }
    eligible_slots = {
        player.player_id: tuple(
            slot
            for code in _ordered_slot_codes(slot_targets)
            if _slot_fits(player, code)
            for slot in slots_by_code[code]
        )
        for player in available_players
    }
    matching = maximum_bipartite_matching(
        candidates=tuple(player.player_id for player in available_players),
        slots=slots,
        eligible_slots=eligible_slots,
    )
    unmatched_codes = {slot.slot_code for slot in matching.unmatched_slots}
    blocking_players = tuple(
        player.player_id for player in available_players if any(_slot_fits(player, code) for code in unmatched_codes)
    )
    unmatched_counts = Counter(slot.slot_code for slot in matching.unmatched_slots)
    slot_deficits = tuple(
        SlotDeficit(
            slot_code=code,
            unmatched_slots=unmatched_counts[code],
            eligible_players=sum(_slot_fits(player, code) for player in available_players),
        )
        for code in _ordered_slot_codes(slot_targets)
        if unmatched_counts[code]
    )
    reason_code = "role_overfilled" if overfilled else ("role_shortage" if matching.unmatched_slots else None)
    return DraftFeasibilityReport(
        is_feasible=not overfilled and not matching.unmatched_slots,
        total_open_slots=len(slots),
        matched_slots=matching.matched_count,
        unmatched_slots=matching.unmatched_slots,
        slot_deficits=slot_deficits,
        blocking_player_ids=blocking_players,
        reason_code=reason_code,
    )


def evaluate_pick_options(
    *,
    team_id: int,
    team_ids: Collection[int],
    slot_targets: Mapping[str, int],
    players: Collection[EligiblePlayer],
    assignments: Collection[DraftAssignment] = (),
) -> tuple[DraftPickOption, ...]:
    """Return safe/blocked role choices for every available player."""

    remaining, _ = _remaining_capacity(
        team_ids=team_ids,
        slot_targets=slot_targets,
        assignments=assignments,
    )
    options: list[DraftPickOption] = []
    # Players with the same declared role set are interchangeable for the
    # feasibility question. Cache one forced-pick matching per role-set/role
    # pair; at the supported scale this reduces hundreds of equivalent graph
    # runs to at most 21 (seven non-empty subsets of three canonical roles).
    report_cache: dict[tuple[frozenset[HeroClass], HeroClass], tuple[int, DraftFeasibilityReport]] = {}
    for player in players:
        for role in HERO_TYPE_CLASSES:
            if role not in player.playable_roles:
                continue
            # A role a team can still take: its own role slot, or any free flex
            # slot. Only when both are gone is the option genuinely unavailable.
            if remaining.get((team_id, role.slot_code), 0) + remaining.get((team_id, FLEX_SLOT_CODE), 0) <= 0:
                options.append(
                    DraftPickOption(
                        player_id=player.player_id,
                        role=role,
                        is_safe=False,
                        reason_code="slot_filled",
                    )
                )
                continue
            cache_key = (player.playable_roles, role)
            cached = report_cache.get(cache_key)
            if cached is None:
                report = analyze_draft_feasibility(
                    team_ids=team_ids,
                    slot_targets=slot_targets,
                    players=players,
                    assignments=assignments,
                    hypothetical=DraftAssignment(player_id=player.player_id, team_id=team_id, slot_code=role.slot_code),
                )
                representative_id = player.player_id
                report_cache[cache_key] = (representative_id, report)
            else:
                representative_id, report = cached
            blocking_player_ids = report.blocking_player_ids
            if representative_id != player.player_id:
                blocking_player_ids = tuple(
                    representative_id if player_id == player.player_id else player_id
                    for player_id in blocking_player_ids
                )
            options.append(
                DraftPickOption(
                    player_id=player.player_id,
                    role=role,
                    is_safe=report.is_feasible,
                    reason_code=None if report.is_feasible else report.reason_code,
                    unmatched_slots=report.unmatched_slots,
                    blocking_player_ids=blocking_player_ids,
                )
            )
    return tuple(options)


__all__ = (
    "DraftAssignment",
    "DraftFeasibilityReport",
    "DraftFeasibilityState",
    "DraftPickOption",
    "DraftSlot",
    "DraftSnapshot",
    "EligiblePlayer",
    "SlotDeficit",
    "analyze_draft_feasibility",
    "analyze_session",
    "build_feasibility_state",
    "describe_role_deficits",
    "evaluate_pick_options",
    "evaluate_session_pick_options",
    "load_feasibility_state",
    "load_snapshot",
    "resolve_shape",
    "state_from_snapshot",
)
