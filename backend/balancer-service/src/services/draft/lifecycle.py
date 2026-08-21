"""Draft session lifecycle: create, seed, and status transitions.

Services flush within the caller's transaction (routes/worker commit). Status
moves are guarded by ``shared.core.draft_state``. The pick clock is
DB-resumable: absolute ``clock_expires_at`` while live, frozen
``clock_remaining_ms`` while paused.

Pure business rules (seat ordering, registration mapping, seed-row building)
live in ``src.domain.draft.rules`` — this file holds only the orchestration
that needs a database session.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import sqlalchemy as sa
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from shared.balancer_registration_statuses import balancer_pool_included_clause
from shared.core import draft_state
from shared.core.enums import (
    DraftCaptainOrder,
    DraftFormat,
    DraftPickStatus,
    DraftPlayerStatus,
    DraftStatus,
    HeroClass,
    TournamentStatus,
)
from shared.domain.roster_shape import RosterShape
from shared.models.balancer.draft import DraftPick, DraftPlayer, DraftSession, DraftTeam
from shared.models.registration.registration import (
    BalancerRegistration,
    BalancerRegistrationForm,
    BalancerRegistrationRole,
    BalancerRegistrationRoleHero,
)
from shared.models.tenancy.workspace import WorkspaceMember
from shared.models.tournament import Tournament
from shared.repository.draft import (
    DraftPickRepository,
    DraftPlayerRepository,
    DraftSessionRepository,
    DraftTeamRepository,
)
from shared.repository.workspace import get_or_create_workspace_member
from src.domain.draft import rules
from src.domain.draft.entities import CaptainSeed, PlayerSeed
from src.domain.draft.errors import err as _err
from src.services.draft.feasibility import DraftFeasibilityService, feasibility_service

__all__ = ("DraftLifecycleService", "lifecycle_service")


class DraftLifecycleService:
    def __init__(
        self,
        *,
        sessions_repo: DraftSessionRepository = DraftSessionRepository(),
        teams_repo: DraftTeamRepository = DraftTeamRepository(),
        players_repo: DraftPlayerRepository = DraftPlayerRepository(),
        picks_repo: DraftPickRepository = DraftPickRepository(),
        feasibility: DraftFeasibilityService = feasibility_service,
    ) -> None:
        self.sessions_repo = sessions_repo
        self.teams_repo = teams_repo
        self.players_repo = players_repo
        self.picks_repo = picks_repo
        self.feasibility = feasibility

    async def assert_no_active_draft(self, session: AsyncSession, tournament_id: int) -> None:
        if await self.sessions_repo.exists_active_for_tournament(session, tournament_id):
            raise _err("draft_already_active", f"Tournament {tournament_id} already has an active draft")

    async def seed_row_counts(self, session: AsyncSession, session_id: int) -> tuple[int, int, int]:
        """Existing (team, player, pick) row counts for a session, in one round trip.

        Three scalar subqueries instead of three separate ``COUNT`` statements —
        used by the seed-diff preview (``rpc/draft.py``'s ``_seed`` handler) to
        report what a re-seed would replace. Deliberately not hidden behind a
        single-model repository: it spans three models in one query.
        """
        row = (
            await session.execute(
                sa.select(
                    *(
                        sa.select(sa.func.count())
                        .select_from(model)
                        .where(model.session_id == session_id)
                        .scalar_subquery()
                        for model in (DraftTeam, DraftPlayer, DraftPick)
                    )
                )
            )
        ).one()
        return int(row[0] or 0), int(row[1] or 0), int(row[2] or 0)

    async def create_session(
        self,
        session: AsyncSession,
        *,
        tournament_id: int,
        workspace_id: int,
        shape: RosterShape,
        pool_source: str = "balancer_balance",
        source_balance_id: int | None = None,
        fmt: DraftFormat = DraftFormat.SNAKE,
        pick_time_seconds: int = 45,
        autopick_strategy: str = "best_fit",
        allow_admin_override: bool = True,
        settings: dict | None = None,
    ) -> DraftSession:
        # `rounds` is derived, never passed: the shape owns the roster size.
        await self.assert_no_active_draft(session, tournament_id)
        draft = DraftSession(
            tournament_id=tournament_id,
            workspace_id=workspace_id,
            status=DraftStatus.SETUP.value,
            format=fmt.value,
            rounds=shape.draft_rounds,
            pick_time_seconds=pick_time_seconds,
            pool_source=pool_source,
            source_balance_id=source_balance_id,
            autopick_strategy=autopick_strategy,
            allow_admin_override=allow_admin_override,
            settings_json=settings or {},
        )
        draft = await self.sessions_repo.create(session, draft)
        await session.refresh(draft)
        return draft

    async def resync_pick_order(self, session: AsyncSession, draft_session: DraftSession) -> int:
        """Re-seat every round that has not started yet. Returns how many picks moved.

        ``round_rules`` lives on the session while the pick rows are materialized at
        seed time, so changing a rule afterwards used to change nothing on the board:
        the wizard previewed the new order and the draft kept picking in the old one.
        Callers run this after a settings change so the two cannot disagree.

        A round holding any pick that is no longer UPCOMING is history and is left
        alone -- reordering a round somebody already picked in would rewrite who
        picked when. Dynamic ``team_avg_*`` rounds keep the seed order here; they are
        re-seated when they start.
        """
        teams = await self.teams_repo.list_by_session(session, draft_session.id)
        if not teams:
            return 0
        picks = await self.picks_repo.list_by_session(session, draft_session.id)
        if not picks:
            return 0

        captain_ranks = {
            captain.drafted_by_team_id: (captain.rank_value if captain.rank_value is not None else -1)
            for captain in await self.players_repo.list_drafted_captains(session, draft_session.id)
        }
        fmt = DraftFormat(draft_session.format)
        round_rules = draft_session.settings_json.get("round_rules") or []

        by_round: dict[int, list[DraftPick]] = {}
        for pick in picks:
            by_round.setdefault(pick.round_no, []).append(pick)

        moved = 0
        for round_no, round_picks in by_round.items():
            if any(pick.status != DraftPickStatus.UPCOMING.value for pick in round_picks):
                continue
            round_seats = rules.round_seat_order(
                list(teams),
                fmt=fmt,
                round_rules=round_rules,
                round_idx=round_no - 1,
                captain_ranks=captain_ranks,
            )
            for pick, team in zip(sorted(round_picks, key=lambda p: p.pick_in_round), round_seats, strict=False):
                if pick.draft_team_id != team.id:
                    pick.draft_team_id = team.id
                    moved += 1
        if moved:
            await session.flush()
        return moved

    async def seed(
        self,
        session: AsyncSession,
        draft_session: DraftSession,
        *,
        captains: list[CaptainSeed],
        players: list[PlayerSeed],
    ) -> DraftSession:
        """Materialize teams + pool + all picks, then transition SETUP/READY -> READY."""
        if draft_session.status not in (DraftStatus.SETUP.value, DraftStatus.READY.value):
            raise _err("draft_not_seedable", "Draft can only be seeded in SETUP or READY")
        if not captains:
            raise _err("draft_no_captains", "At least one captain is required to seed a draft")

        draft_state.validate_transition(DraftStatus(draft_session.status), DraftStatus.READY)

        # Re-seed: clear any prior teams/players/picks (cascade via relationships).
        await self.picks_repo.delete_by_session(session, draft_session.id)
        await self.players_repo.delete_by_session(session, draft_session.id)
        await self.teams_repo.delete_by_session(session, draft_session.id)
        draft_session.current_pick_id = None
        await session.flush()

        ordered_captains = sorted(captains, key=lambda c: c.draft_position)

        # Resolve domain player ids -> workspace_member rows for this session's
        # workspace (dbarch03: draft identity is anchored on workspace_member). Done
        # once up front so every team/player row reuses the same member id.
        player_ids = {c.user_id for c in ordered_captains if c.user_id is not None}
        player_ids |= {p.user_id for p in players if p.user_id is not None}
        member_by_player: dict[int, int] = {}
        if player_ids:
            # Batch-prefetch existing membership rows (the common case on re-seed)
            # instead of one INSERT..ON CONFLICT round-trip per player.
            rows = await session.execute(
                sa.select(WorkspaceMember.player_id, WorkspaceMember.id).where(
                    WorkspaceMember.workspace_id == draft_session.workspace_id,
                    WorkspaceMember.player_id.in_(player_ids),
                )
            )
            member_by_player = dict(rows.tuples().all())
        # get_or_create also autofills the baseline RBAC role for a brand-new
        # auth-linked member — keep that side effect, but only pay for it on
        # players that genuinely have no membership row yet.
        for player_id in player_ids - member_by_player.keys():
            member = await get_or_create_workspace_member(
                session, workspace_id=draft_session.workspace_id, player_id=player_id
            )
            member_by_player[player_id] = member.id

        def _member_id(user_id: int | None) -> int | None:
            return member_by_player.get(user_id) if user_id is not None else None

        teams: list[DraftTeam] = []
        team_by_position: dict[int, DraftTeam] = {}
        for cap in ordered_captains:
            team = DraftTeam(
                session_id=draft_session.id,
                captain_workspace_member_id=_member_id(cap.user_id),
                captain_auth_user_id=cap.auth_user_id,
                name=cap.name,
                draft_position=cap.draft_position,
            )
            teams.append(team)
            team_by_position[cap.draft_position] = team
        await self.teams_repo.create_many(session, teams)

        # Captains become PICKED players already on their roster.
        players_to_create: list[DraftPlayer] = []
        for cap in ordered_captains:
            team = team_by_position[cap.draft_position]
            # Real role from the pool when available; TANK placeholder otherwise.
            cap_primary = cap.primary_role or HeroClass.tank
            players_to_create.append(
                DraftPlayer(
                    session_id=draft_session.id,
                    workspace_member_id=_member_id(cap.user_id),
                    battle_tag=cap.battle_tag,
                    primary_role=cap_primary.slot_code,
                    sub_role=cap.sub_role,
                    is_flex=cap.is_flex,
                    division_number=cap.division_number,
                    rank_value=cap.rank_value,
                    is_captain=True,
                    status=DraftPlayerStatus.PICKED.value,
                    drafted_by_team_id=team.id,
                    additional_info=cap.additional_info,
                    roles=rules.seed_role_rows(cap_primary, [], cap.role_ranks, cap.role_top_heroes),
                )
            )
        # Pool players.
        for p in players:
            players_to_create.append(
                DraftPlayer(
                    session_id=draft_session.id,
                    workspace_member_id=_member_id(p.user_id),
                    battle_tag=p.battle_tag,
                    primary_role=p.primary_role.slot_code,
                    sub_role=p.sub_role,
                    is_flex=p.is_flex,
                    division_number=p.division_number,
                    rank_value=p.rank_value,
                    status=DraftPlayerStatus.AVAILABLE.value,
                    additional_info=p.additional_info,
                    roles=rules.seed_role_rows(p.primary_role, p.secondary_roles, p.role_ranks, p.role_top_heroes),
                )
            )
        await self.players_repo.create_many(session, players_to_create)

        # Pre-create all picks in deterministic order based on round rules.
        seats = [team_by_position[pos] for pos in sorted(team_by_position)]
        team_captain_ranks = {
            team_by_position[cap.draft_position].id: (cap.rank_value if cap.rank_value is not None else -1)
            for cap in ordered_captains
        }

        fmt = DraftFormat(draft_session.format)
        round_rules = draft_session.settings_json.get("round_rules") or []

        picks: list[DraftPick] = []
        overall_no = 1
        for round_idx in range(draft_session.rounds):
            round_seats = rules.round_seat_order(
                seats,
                fmt=fmt,
                round_rules=round_rules,
                round_idx=round_idx,
                captain_ranks=team_captain_ranks,
            )
            for pick_in_round, team in enumerate(round_seats, start=1):
                picks.append(
                    DraftPick(
                        session_id=draft_session.id,
                        overall_no=overall_no,
                        round_no=round_idx + 1,
                        pick_in_round=pick_in_round,
                        draft_team_id=team.id,
                        status=DraftPickStatus.UPCOMING.value,
                        version=0,
                    )
                )
                overall_no += 1
        await self.picks_repo.create_many(session, picks)

        draft_session.status = DraftStatus.READY.value
        draft_session.blocked_reason = None
        rules.bump_seed_version(draft_session)
        # expire_on_commit=False and all mutations above are Python-side: the
        # in-memory session row is already current, no refresh round-trip needed.
        await session.flush()
        return draft_session

    async def load_pool(self, session: AsyncSession, tournament_id: int) -> list[BalancerRegistration]:
        """Load the balancer pool = registrations included in the balancer.

        Mirrors the panel's ``isRegistrationIncludedInBalancer``: approved, not
        deleted, and the current balancer_status doesn't exclude it (not_in_balancer
        / excluded / a workspace custom status configured to exclude).
        """
        workspace_id_expr = sa.select(Tournament.workspace_id).where(Tournament.id == tournament_id).scalar_subquery()
        return list(
            await session.scalars(
                sa.select(BalancerRegistration)
                .where(
                    BalancerRegistration.tournament_id == tournament_id,
                    BalancerRegistration.status == "approved",
                    BalancerRegistration.deleted_at.is_(None),
                    balancer_pool_included_clause(BalancerRegistration.balancer_status, workspace_id_expr),
                )
                .options(
                    selectinload(BalancerRegistration.roles)
                    .selectinload(BalancerRegistrationRole.hero_entries)
                    .selectinload(BalancerRegistrationRoleHero.hero),
                    # Needed by rules.registration_player_id / registration_auth_user_id
                    # (the member is the registration's only identity anchor).
                    selectinload(BalancerRegistration.workspace_member).selectinload(WorkspaceMember.player),
                )
                .order_by(BalancerRegistration.battle_tag_normalized.asc())
            )
        )

    async def seed_from_pool(
        self,
        session: AsyncSession,
        draft_session: DraftSession,
        *,
        captain_registration_ids: list[int],
        team_names: dict[int, str] | None = None,
        captain_order: DraftCaptainOrder = DraftCaptainOrder.MANUAL,
        rng_seed: int | None = None,
    ) -> DraftSession:
        """Seed a draft from the balancer registration pool.

        ``captain_registration_ids`` are ``balancer.registration`` ids chosen as
        captains. ``captain_order`` decides seat order (who picks first) — e.g.
        WEAKEST_FIRST seats the lowest-rated captain at position 1. Every other
        in-pool registration becomes an available draft player; roles/ranks come from
        the registration.
        """
        pool = await self.load_pool(session, draft_session.tournament_id)
        # First read of the registration form from balancer-service. One query per
        # seed; the mode decides whether role is a constraint at all.
        all_roles = rules.all_roles_required(
            await session.scalar(
                sa.select(BalancerRegistrationForm).where(
                    BalancerRegistrationForm.tournament_id == draft_session.tournament_id
                )
            )
        )
        by_id = {reg.id: reg for reg in pool}
        if not captain_registration_ids:
            raise _err("draft_no_captains", "Select at least one captain from the pool")

        team_names = team_names or {}
        mapped_by_id: dict[int, dict] = {}
        for rid in captain_registration_ids:
            reg = by_id.get(rid)
            if reg is None:
                raise _err(
                    "captain_not_in_pool",
                    f"Captain registration {rid} is not in the balancer pool for this tournament",
                    status_code=422,
                )
            mapped_by_id[rid] = rules.map_registration(reg, all_roles=all_roles)

        ordered_ids = rules.order_captain_ids(
            [(rid, mapped_by_id[rid]["rank_value"]) for rid in captain_registration_ids],
            captain_order,
            rng_seed,
        )

        captains: list[CaptainSeed] = []
        for position, rid in enumerate(ordered_ids, start=1):
            reg = by_id[rid]
            mapped = mapped_by_id[rid]
            captains.append(
                CaptainSeed(
                    name=team_names.get(rid) or reg.battle_tag or reg.display_name or f"Team {position}",
                    draft_position=position,
                    user_id=rules.registration_player_id(reg),
                    auth_user_id=rules.registration_auth_user_id(reg),
                    battle_tag=reg.battle_tag,
                    primary_role=mapped["primary_role"],
                    sub_role=mapped["sub_role"],
                    is_flex=mapped["is_flex"],
                    division_number=mapped["division_number"],
                    rank_value=mapped["rank_value"],
                    role_ranks=mapped.get("role_ranks") or {},
                    role_top_heroes=mapped.get("role_top_heroes") or {},
                    additional_info=mapped.get("additional_info") or {},
                )
            )

        captain_ids = set(captain_registration_ids)
        players: list[PlayerSeed] = []
        for reg in pool:
            if reg.id in captain_ids:
                continue
            mapped = rules.map_registration(reg, all_roles=all_roles)
            players.append(
                PlayerSeed(
                    primary_role=mapped["primary_role"],
                    user_id=rules.registration_player_id(reg),
                    battle_tag=reg.battle_tag,
                    secondary_roles=mapped["secondary_roles"],
                    sub_role=mapped["sub_role"],
                    is_flex=mapped["is_flex"],
                    division_number=mapped["division_number"],
                    rank_value=mapped["rank_value"],
                    role_ranks=mapped.get("role_ranks") or {},
                    role_top_heroes=mapped.get("role_top_heroes") or {},
                    additional_info=mapped.get("additional_info") or {},
                )
            )

        return await self.seed(session, draft_session, captains=captains, players=players)

    async def _first_upcoming(self, session: AsyncSession, draft_session_id: int) -> DraftPick | None:
        return await self.picks_repo.first_upcoming(session, draft_session_id)

    async def start(self, session: AsyncSession, draft_session: DraftSession, *, force: bool = False) -> DraftSession:
        draft_state.validate_transition(DraftStatus(draft_session.status), DraftStatus.LIVE)
        # The phase gate keeps organizers from going live before the tournament
        # reaches its draft phase. A superuser may bypass it (``force``) to run a
        # draft out of band — a test run, or a rescue after the schedule drifted.
        if not force:
            tournament_status = await session.scalar(
                sa.select(Tournament.status).where(Tournament.id == draft_session.tournament_id)
            )
            if tournament_status != TournamentStatus.DRAFT.value:
                raise _err(
                    "tournament_not_in_draft_phase",
                    "Draft can only start while the tournament is in the draft phase",
                )
        first = await self._first_upcoming(session, draft_session.id)
        if first is None:
            raise _err("draft_no_picks", "Draft has no picks to start")
        report = await self.feasibility.analyze_session(session, draft_session)
        if not report.is_feasible:
            raise rules.role_shortage_error(report)
        now = datetime.now(UTC)
        rules.arm_clock(first, draft_session.pick_time_seconds, now)
        draft_session.status = DraftStatus.LIVE.value
        draft_session.blocked_reason = None
        draft_session.current_pick_id = first.id
        await session.flush()
        return draft_session

    async def pause(self, session: AsyncSession, draft_session: DraftSession) -> DraftSession:
        draft_state.validate_transition(DraftStatus(draft_session.status), DraftStatus.PAUSED)
        now = datetime.now(UTC)
        current = (
            await self.picks_repo.get(session, draft_session.current_pick_id)
            if draft_session.current_pick_id
            else None
        )
        if current is not None and current.clock_expires_at is not None:
            remaining = (current.clock_expires_at - now).total_seconds() * 1000.0
            current.clock_remaining_ms = max(0, int(remaining))
            current.clock_expires_at = None
        draft_session.status = DraftStatus.PAUSED.value
        draft_session.blocked_reason = None
        await session.flush()
        return draft_session

    async def resume(self, session: AsyncSession, draft_session: DraftSession) -> DraftSession:
        draft_state.validate_transition(DraftStatus(draft_session.status), DraftStatus.LIVE)
        report = await self.feasibility.analyze_session(session, draft_session)
        if not report.is_feasible:
            raise rules.role_shortage_error(report)
        now = datetime.now(UTC)
        current = (
            await self.picks_repo.get(session, draft_session.current_pick_id)
            if draft_session.current_pick_id
            else None
        )
        if current is not None:
            remaining_ms = (
                current.clock_remaining_ms
                if current.clock_remaining_ms is not None
                else (draft_session.pick_time_seconds * 1000)
            )
            current.clock_started_at = now
            current.clock_expires_at = now + timedelta(milliseconds=remaining_ms)
            current.clock_remaining_ms = None
        draft_session.status = DraftStatus.LIVE.value
        draft_session.blocked_reason = None
        await session.flush()
        return draft_session

    async def cancel(self, session: AsyncSession, draft_session: DraftSession) -> DraftSession:
        draft_state.validate_transition(DraftStatus(draft_session.status), DraftStatus.CANCELLED)
        draft_session.status = DraftStatus.CANCELLED.value
        draft_session.blocked_reason = None
        await session.flush()
        return draft_session

    async def delete_session(self, session: AsyncSession, draft_session: DraftSession) -> None:
        """Erase a draft session and everything hanging off it.

        A LIVE/PAUSED draft has captains on a clock, so it must be cancelled first;
        every other status is erasable. Teams already exported to the tournament are
        NOT removed: the export is a separate artifact and ``exported_team_id`` is
        only a back-reference into it.
        """
        if draft_session.status not in rules.DELETABLE_STATUSES:
            raise _err("draft_in_flight", "Cancel the draft before deleting it")
        # Drop the session -> current pick reference before the cascade removes that
        # pick, so no flush can write a dangling FK.
        draft_session.current_pick_id = None
        await session.flush()
        # One statement: teams, players, roles, heroes, picks and audit rows all
        # hang off the session with ON DELETE CASCADE, so the ORM cascade would only
        # buy hundreds of round-trips. Expunge keeps the deleted row out of any
        # later flush.
        await self.sessions_repo.delete_by_id(session, draft_session.id)
        session.expunge(draft_session)

    async def rollback(self, session: AsyncSession, draft_session: DraftSession) -> DraftSession:
        """Rollback the last resolved pick, resetting player/pick states and pausing the draft."""
        draft_state.validate_transition(DraftStatus(draft_session.status), DraftStatus.PAUSED)

        # Find the last resolved pick (completed, autopicked, or skipped). Not a
        # repository method: the status set (including SKIPPED) and the
        # desc-ordered "most recent" lookup are specific to this one caller, not a
        # generic CRUD shape (``repository-boundaries.md``: bespoke filters stay in
        # the service).
        last_resolved = await session.scalar(
            sa.select(DraftPick)
            .where(
                DraftPick.session_id == draft_session.id,
                DraftPick.status.in_(
                    [
                        DraftPickStatus.COMPLETED.value,
                        DraftPickStatus.AUTOPICKED.value,
                        DraftPickStatus.SKIPPED.value,
                    ]
                ),
            )
            .order_by(DraftPick.overall_no.desc())
            .limit(1)
        )
        if last_resolved is None:
            raise _err("no_picks_to_rollback", "There are no resolved picks to rollback")

        # Find all picks with overall_no >= last_resolved.overall_no
        picks_to_revert = (
            await session.scalars(
                sa.select(DraftPick)
                .where(
                    DraftPick.session_id == draft_session.id,
                    DraftPick.overall_no >= last_resolved.overall_no,
                )
                .order_by(DraftPick.overall_no.asc())
            )
        ).all()

        player_ids_to_free = [p.picked_player_id for p in picks_to_revert if p.picked_player_id is not None]
        if player_ids_to_free:
            players = await self.players_repo.bulk_get(session, player_ids_to_free)
            for player in players:
                player.status = DraftPlayerStatus.AVAILABLE.value
                player.drafted_by_team_id = None

        for pick in picks_to_revert:
            pick.picked_player_id = None
            pick.picked_by_workspace_member_id = None
            pick.is_autopick = False
            pick.is_admin_override = False
            pick.target_role = None
            # Increment version to prevent race conditions from pending requests
            pick.version += 1

            if pick.id == last_resolved.id:
                pick.status = DraftPickStatus.ON_CLOCK.value
                pick.clock_remaining_ms = draft_session.pick_time_seconds * 1000
                pick.clock_started_at = None
                pick.clock_expires_at = None
            else:
                pick.status = DraftPickStatus.UPCOMING.value
                pick.clock_remaining_ms = None
                pick.clock_started_at = None
                pick.clock_expires_at = None

        draft_session.status = DraftStatus.PAUSED.value
        draft_session.blocked_reason = None
        draft_session.current_pick_id = last_resolved.id
        draft_session.export_status = None
        draft_session.exported_at = None

        await session.flush()
        return draft_session


lifecycle_service = DraftLifecycleService()
