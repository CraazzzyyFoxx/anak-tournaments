"""Draft pick selection, autopick, override, and board advance.

The select-vs-autopick race is resolved by a single conditional UPDATE guarded
by both ``status='on_clock'`` and the optimistic ``version`` token: exactly one
writer's ``rowcount`` is 1, the loser gets a 409. Events are published by the
caller within the same transaction so WorkspaceEvent ids preserve pick order.
"""

from __future__ import annotations

from collections.abc import Collection, Mapping
from datetime import UTC, datetime, timedelta

from sqlalchemy.ext.asyncio import AsyncSession

from shared.core.enums import (
    HERO_TYPE_CLASSES,
    DraftAutopickStrategy,
    DraftFormat,
    DraftPickStatus,
    DraftPlayerStatus,
    DraftStatus,
    HeroClass,
)
from shared.core.errors import ApiHTTPException
from shared.domain.roster_shape import FLEX_SLOT_CODE, RosterShape
from shared.models.balancer.draft import DraftPick, DraftPlayer, DraftSession, DraftTeam
from shared.repository.draft import DraftPickRepository, DraftPlayerRepository, DraftTeamRepository
from shared.repository.workspace import get_or_create_workspace_member
from src.services.draft import lifecycle, loaders, ranks
from src.services.draft import suggestions as sug
from src.services.draft._errors import err as _err
from src.services.draft.entities import (
    DraftAssignment,
    DraftFeasibilityReport,
    DraftResult,
    DraftSnapshot,
    SlotDecision,
)
from src.services.draft.feasibility import DraftFeasibilityService, feasibility_service
from src.services.draft.feasibility_algorithm import describe_role_deficits


def _team_slot_counts(
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
    ``feasibility_algorithm._remaining_capacity`` applies to the same rows.
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


def _role_openings(shape: RosterShape, counts: Mapping[str, int]) -> dict[HeroClass, int]:
    """How many more slots each role can still take on this team.

    A role lands either in its own remaining role slot or in any free flex slot,
    so the two capacities add up. ``suggestions`` only asks whether a role is
    still open and the ``slot_filled`` guard only asks whether it is zero, so one
    number serves both.
    """
    targets = shape.slots
    free_flex = max(0, targets.get(FLEX_SLOT_CODE, 0) - counts.get(FLEX_SLOT_CODE, 0))
    return {role: max(0, targets.get(role.slot_code, 0) - counts.get(role.slot_code, 0)) + free_flex for role in HERO_TYPE_CLASSES}


async def _validate_current_pick(draft_session: DraftSession, pick: DraftPick) -> None:
    if draft_session.status != DraftStatus.LIVE.value:
        raise _err("draft_not_live", "Draft is not live")
    if pick.id != draft_session.current_pick_id or pick.status != DraftPickStatus.ON_CLOCK.value:
        raise _err("pick_not_on_clock", "This is not the current on-clock pick")


def _available_player_from(snapshot: DraftSnapshot, player_id: int) -> DraftPlayer:
    # Snapshot players were loaded with loaders.player_options(), so the compat
    # read properties (secondary_roles_json/role_ranks via _role_is_legal +
    # ranks.role_rank) never trigger an async lazy load.
    player = next((p for p in snapshot.players if p.id == player_id), None)
    if player is None:
        raise _err("player_not_found", "Player not in this draft", status_code=404)
    if player.status != DraftPlayerStatus.AVAILABLE.value:
        raise _err("player_unavailable", "Player is not available")
    return player


def _role_is_legal(player: DraftPlayer, target_role: HeroClass | None) -> bool:
    if target_role is None:
        return True
    if player.is_flex:
        return True
    playable = {player.primary_role, *(player.secondary_roles_json or [])}
    return target_role.slot_code in playable


def _playable_roles(player: DraftPlayer) -> frozenset[HeroClass]:
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
    if not _role_is_legal(player, requested):
        raise _err("illegal_role", "Player cannot play the requested role", status_code=422)
    role = requested or HeroClass.from_slot_code(player.primary_role)
    if _role_openings(shape, counts).get(role, 0) <= 0:
        raise _err(
            "slot_filled",
            f"No roster slot left for {role.slot_code} on this team",
            status_code=422,
        )
    return SlotDecision(role=role, recorded_role=role.slot_code if shape.has_role_slots else None)


def _unsafe_pick_error(report: DraftFeasibilityReport) -> ApiHTTPException:
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


def _is_on_clock_captain(
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


class DraftSelectionService:
    def __init__(
        self,
        *,
        teams_repo: DraftTeamRepository = DraftTeamRepository(),
        players_repo: DraftPlayerRepository = DraftPlayerRepository(),
        picks_repo: DraftPickRepository = DraftPickRepository(),
        feasibility: DraftFeasibilityService = feasibility_service,
    ) -> None:
        self.teams_repo = teams_repo
        self.players_repo = players_repo
        self.picks_repo = picks_repo
        self.feasibility = feasibility

    async def _actor_member_id(
        self, session: AsyncSession, draft_session: DraftSession, actor_user_id: int | None
    ) -> int | None:
        """Resolve an acting captain's domain player id to a workspace_member id.

        dbarch03 anchors ``draft_pick.picked_by`` on ``workspace_member``; the actor
        is identified by their public player id, so map it (idempotently create) to a
        member in this draft's workspace.
        """
        if actor_user_id is None:
            return None
        member = await get_or_create_workspace_member(
            session, workspace_id=draft_session.workspace_id, player_id=actor_user_id
        )
        return member.id

    async def _finalize(
        self,
        session: AsyncSession,
        pick_id: int,
        *,
        status: DraftPickStatus,
        player_id: int | None,
        picked_by_member_id: int | None,
        is_autopick: bool,
        is_admin_override: bool,
        expected_version: int,
    ) -> bool:
        """Atomic conditional finalize. Returns True iff this writer won the race."""
        return await self.picks_repo.finalize_if_on_clock(
            session,
            pick_id,
            expected_version=expected_version,
            status=status,
            player_id=player_id,
            picked_by_member_id=picked_by_member_id,
            is_autopick=is_autopick,
            is_admin_override=is_admin_override,
        )

    async def _apply_dynamic_round_order(
        self, session: AsyncSession, draft_session: DraftSession, next_pick: DraftPick
    ) -> bool:
        """Re-seat a CUSTOM round whose rule ranks teams by their live average.

        Runs on the first pick of a round only. Returns True when the seating
        actually moved — the caller locks the draft on that, so nobody picks
        against the order they were reading a second ago.
        """
        if next_pick.pick_in_round != 1 or draft_session.format != DraftFormat.CUSTOM.value:
            return False
        round_rules = draft_session.settings_json.get("round_rules") or []
        round_idx = next_pick.round_no - 1
        rule = round_rules[round_idx] if round_idx < len(round_rules) else None
        # The seat-order vocabulary lives once, in lifecycle: seeding, the settings
        # resync and this live re-seat have to agree on which rules are dynamic.
        if rule not in lifecycle.DYNAMIC_ROUND_RULES:
            return False

        # Average the drafted-role rank (off-role aware), not the primary-role
        # rank_value.
        avg_by_team = await self._team_avg_drafted_rank(
            session, draft_session.id, await self.feasibility.resolve_shape(session, draft_session)
        )
        teams = await self.teams_repo.list_by_session(session, draft_session.id)
        sorted_team_ids = [
            team.id
            for team in lifecycle.average_seat_order(
                list(teams),
                averages=avg_by_team,
                descending=rule == "team_avg_desc",
            )
        ]
        round_picks = await self.picks_repo.list_by_round(session, draft_session.id, next_pick.round_no)

        changed = False
        for pick_to_update, team_id in zip(round_picks, sorted_team_ids, strict=False):
            if pick_to_update.draft_team_id != team_id:
                pick_to_update.draft_team_id = team_id
                changed = True
        await session.flush()
        # round_picks returned the identity-mapped objects, so next_pick's
        # draft_team_id reassignment above is already visible in memory.
        return changed

    async def _advance(self, session: AsyncSession, draft_session: DraftSession) -> DraftPick | None:
        """Move the next UPCOMING pick to ON_CLOCK, or complete the draft.

        When the starting round re-seated the teams under the captains (a dynamic
        ``team_avg_*`` rule), the pick goes on the clock unarmed and the session
        pauses instead of running: the board changed order, so everyone has to
        re-read it before anyone may act. An admin resume arms a full pick timer.
        """
        next_pick = await self.picks_repo.next_upcoming_locked(session, draft_session.id)
        if next_pick is None:
            draft_session.status = DraftStatus.COMPLETED.value
            draft_session.current_pick_id = None
            await session.flush()
            return None

        reordered = await self._apply_dynamic_round_order(session, draft_session, next_pick)

        next_pick.status = DraftPickStatus.ON_CLOCK.value
        next_pick.clock_remaining_ms = None
        draft_session.current_pick_id = next_pick.id
        if reordered:
            draft_session.status = DraftStatus.PAUSED.value
            draft_session.blocked_reason = "order_recalculated"
            # No deadline and no recorded remainder: lifecycle.resume() arms a full
            # pick timer for whoever the new order put on the clock.
            next_pick.clock_started_at = None
            next_pick.clock_expires_at = None
        else:
            now = datetime.now(UTC)
            next_pick.clock_started_at = now
            next_pick.clock_expires_at = now + timedelta(seconds=draft_session.pick_time_seconds)
        await session.flush()
        return next_pick

    async def _apply_won(
        self,
        session: AsyncSession,
        draft_session: DraftSession,
        pick: DraftPick,
        player: DraftPlayer,
    ) -> DraftResult:
        player.status = DraftPlayerStatus.PICKED.value
        player.drafted_by_team_id = pick.draft_team_id
        await session.flush()
        next_pick = await self._advance(session, draft_session)
        # No refresh needed: _finalize syncs the pick via synchronize_session and
        # draft_session was only mutated in Python (expire_on_commit=False).
        return DraftResult(
            pick=pick,
            next_pick=next_pick,
            completed=next_pick is None,
            # Set by _advance when the next round re-seated the teams.
            blocked_reason=draft_session.blocked_reason,
        )

    async def _team_avg_drafted_rank(
        self, session: AsyncSession, draft_session_id: int, shape: RosterShape
    ) -> dict[int, float]:
        """Average drafted-role rank per team (picked players + captains).

        Uses each pick's frozen ``target_rank_value``; falls back to the rank the
        shape gives the drafted/primary role (captains have no pick). A role-less
        shape ignores the frozen value: it was frozen against a role the shape gives
        no meaning to, so ``slot_rank`` re-derives the same maximum every other
        reader of a flex draft shows.
        """
        all_players = await self.players_repo.list_by_session(
            session, draft_session_id, options=loaders.player_options()  # role_rank reads role_ranks
        )
        players = [
            p for p in all_players if p.drafted_by_team_id is not None and p.status == DraftPlayerStatus.PICKED.value
        ]
        picks = await self.picks_repo.list_resolved(session, draft_session_id)
        pick_by_player_id = {pk.picked_player_id: pk for pk in picks if pk.picked_player_id is not None}

        sums: dict[int, float] = {}
        counts: dict[int, int] = {}
        for p in players:
            pk = pick_by_player_id.get(p.id)
            if shape.has_role_slots and pk is not None and pk.target_rank_value is not None:
                rank = pk.target_rank_value
            else:
                role = (pk.target_role if pk else None) or p.primary_role
                rank = ranks.slot_rank(p, role, shape) or 0
            tid = p.drafted_by_team_id
            sums[tid] = sums.get(tid, 0.0) + rank
            counts[tid] = counts.get(tid, 0) + 1
        return {tid: sums[tid] / counts[tid] for tid in sums}

    async def select(
        self,
        session: AsyncSession,
        draft_session: DraftSession,
        pick: DraftPick,
        *,
        player_id: int,
        expected_version: int,
        target_role: HeroClass | None,
        actor_user_id: int | None,
        actor_auth_user_id: int | None = None,
        actor_player_ids: Collection[int] = (),
        is_admin: bool,
    ) -> DraftResult:
        await _validate_current_pick(draft_session, pick)
        # captain_user_id (read in _is_on_clock_captain) resolves via captain_member;
        # eager-load it so the property read never triggers an async lazy load.
        team = await self.teams_repo.get(
            session, pick.draft_team_id, options=loaders.team_options(), populate_existing=True
        )
        player_ids = set(actor_player_ids)
        if actor_user_id is not None:
            player_ids.add(actor_user_id)
        if not is_admin and not _is_on_clock_captain(
            team,
            actor_auth_user_id=actor_auth_user_id,
            actor_player_ids=player_ids,
        ):
            raise _err("not_your_pick", "Only the on-clock captain may pick", status_code=403)
        snapshot = await self.feasibility.load_snapshot(session, draft_session)
        shape = await self.feasibility.resolve_shape(session, draft_session)
        player = _available_player_from(snapshot, player_id)
        counts = _team_slot_counts(snapshot.players, snapshot.picks, pick.draft_team_id, shape)
        decision = resolve_pick_slot(shape, counts, player, target_role)

        feasibility_report = await self.feasibility.analyze_session(
            session,
            draft_session,
            state=await self.feasibility.state_from_snapshot(session, draft_session, snapshot),
            hypothetical=DraftAssignment(
                player_id=player.id,
                team_id=pick.draft_team_id,
                slot_code=decision.role.slot_code,
            ),
        )
        if not feasibility_report.is_feasible:
            raise _unsafe_pick_error(feasibility_report)

        won = await self._finalize(
            session,
            pick.id,
            status=DraftPickStatus.COMPLETED,
            player_id=player.id,
            picked_by_member_id=await self._actor_member_id(session, draft_session, actor_user_id),
            is_autopick=False,
            is_admin_override=False,
            expected_version=expected_version,
        )
        if not won:
            raise _err("pick_already_resolved", "Pick was already resolved")
        # Always record the resolved decision (role + its rank) on the pick, so the
        # pick is a complete (player, role, rank) record regardless of off-role. A
        # role-less roster records no role: recorded_role is None there.
        pick.target_role = decision.recorded_role
        pick.target_rank_value = ranks.slot_rank(player, decision.role, shape)
        return await self._apply_won(session, draft_session, pick, player)

    async def autopick(
        self,
        session: AsyncSession,
        draft_session: DraftSession,
        pick: DraftPick,
        *,
        expected_version: int,
        actor_user_id: int | None = None,
    ) -> DraftResult:
        await _validate_current_pick(draft_session, pick)
        snapshot = await self.feasibility.load_snapshot(session, draft_session)
        shape = await self.feasibility.resolve_shape(session, draft_session)
        # Fit construction reads secondary_roles_json/user_id/role_ranks; snapshot
        # players carry loaders.player_options() so those never lazy-load.
        available = [p for p in snapshot.players if p.status == DraftPlayerStatus.AVAILABLE.value]
        counts = _team_slot_counts(snapshot.players, snapshot.picks, pick.draft_team_id, shape)
        capacity = _role_openings(shape, counts)

        fit_players = [
            sug.FitPlayer(
                player_id=p.id,
                rank_value=p.rank_value or 0,
                playable_roles=_playable_roles(p),
                preference_order=(HeroClass.from_slot_code(p.primary_role),),
                is_flex=p.is_flex,
                user_id=p.user_id,
                rank_by_role={HeroClass.from_slot_code(k): v for k, v in (p.role_ranks or {}).items()},
            )
            for p in available
        ]
        options = await self.feasibility.evaluate_session_pick_options(
            session,
            draft_session,
            team_id=pick.draft_team_id,
            state=await self.feasibility.state_from_snapshot(session, draft_session, snapshot),
        )
        safe_options = {(option.player_id, option.role) for option in options if option.is_safe}
        choice = sug.best_fit(
            fit_players,
            capacity,
            DraftAutopickStrategy(draft_session.autopick_strategy),
            sug.FitConfig(),
            allowed_options=safe_options,
        )
        chosen_id = choice.player_id if choice is not None else None
        chosen_role = choice.role if choice is not None else None

        if chosen_id is None:
            result = mark_role_shortage_paused(draft_session, pick)
            await session.flush()
            return result

        won = await self._finalize(
            session,
            pick.id,
            status=DraftPickStatus.AUTOPICKED,
            player_id=chosen_id,
            picked_by_member_id=None,
            is_autopick=True,
            is_admin_override=False,
            expected_version=expected_version,
        )
        if not won:
            raise _err("pick_already_resolved", "Pick was already resolved")
        # ranks.role_rank(player, ...) reads role_ranks -> roles; the chosen row came
        # from the snapshot's eager-loaded players, so no re-fetch is needed.
        player = next(p for p in available if p.id == chosen_id)
        resolved_role = chosen_role or HeroClass.from_slot_code(player.primary_role)
        pick.target_role = resolved_role.slot_code if shape.has_role_slots else None
        pick.target_rank_value = ranks.slot_rank(player, resolved_role, shape)
        return await self._apply_won(session, draft_session, pick, player)

    async def override(
        self,
        session: AsyncSession,
        draft_session: DraftSession,
        pick: DraftPick,
        *,
        player_id: int | None,
        expected_version: int,
        actor_user_id: int | None,
        target_role: HeroClass | None = None,
    ) -> DraftResult:
        if not draft_session.allow_admin_override:
            raise _err("override_disabled", "Admin override is disabled for this draft")
        await _validate_current_pick(draft_session, pick)
        if player_id is None:
            raise _err("override_needs_player", "Override requires a player_id", status_code=422)
        snapshot = await self.feasibility.load_snapshot(session, draft_session)
        shape = await self.feasibility.resolve_shape(session, draft_session)
        player = _available_player_from(snapshot, player_id)
        counts = _team_slot_counts(snapshot.players, snapshot.picks, pick.draft_team_id, shape)
        decision = resolve_pick_slot(shape, counts, player, target_role)
        feasibility_report = await self.feasibility.analyze_session(
            session,
            draft_session,
            state=await self.feasibility.state_from_snapshot(session, draft_session, snapshot),
            hypothetical=DraftAssignment(
                player_id=player.id,
                team_id=pick.draft_team_id,
                slot_code=decision.role.slot_code,
            ),
        )
        if not feasibility_report.is_feasible:
            raise _unsafe_pick_error(feasibility_report)

        won = await self._finalize(
            session,
            pick.id,
            status=DraftPickStatus.COMPLETED,
            player_id=player.id,
            picked_by_member_id=await self._actor_member_id(session, draft_session, actor_user_id),
            is_autopick=False,
            is_admin_override=True,
            expected_version=expected_version,
        )
        if not won:
            raise _err("pick_already_resolved", "Pick was already resolved")
        pick.target_role = decision.recorded_role
        pick.target_rank_value = ranks.slot_rank(player, decision.role, shape)
        return await self._apply_won(session, draft_session, pick, player)


selection_service = DraftSelectionService()
