"""Session-scoped draft feasibility: DB-backed reads plus CPU-offloaded analysis.

Pure value types live in ``src.domain.draft.entities``; the pure bipartite-
matching rules live in ``src.domain.draft.feasibility``. This module is the
only one of the three that touches a database session or the event loop — it
loads rows, translates them into the algorithm's input, and runs the
CPU-bound matching via ``asyncio.to_thread``.
"""

from __future__ import annotations

import asyncio

from sqlalchemy.ext.asyncio import AsyncSession

from shared.domain.roster_shape import RosterShape
from shared.models.balancer.draft import DraftSession
from shared.repository.draft import DraftPickRepository, DraftPlayerRepository, DraftTeamRepository
from shared.services.roster_shape_access import get_effective_roster_shape
from src.domain.draft.entities import (
    DraftAssignment,
    DraftFeasibilityReport,
    DraftFeasibilityState,
    DraftPickOption,
    DraftSnapshot,
)
from src.domain.draft.feasibility import (
    analyze_draft_feasibility,
    build_feasibility_state,
    evaluate_pick_options,
)
from src.services.draft import loaders
from src.services.draft.rosters import DraftRosterService, draft_rosters

__all__ = ("DraftFeasibilityService", "feasibility_service")


class DraftFeasibilityService:
    def __init__(
        self,
        *,
        teams_repo: DraftTeamRepository = DraftTeamRepository(),
        players_repo: DraftPlayerRepository = DraftPlayerRepository(),
        picks_repo: DraftPickRepository = DraftPickRepository(),
        rosters: DraftRosterService = draft_rosters,
    ) -> None:
        self.teams_repo = teams_repo
        self.players_repo = players_repo
        self.picks_repo = picks_repo
        self.rosters = rosters

    async def load_snapshot(self, session: AsyncSession, draft_session: DraftSession) -> DraftSnapshot:
        """Load the session's rows once, and resolve their rosters once with them.

        Roles and ranks ride in the snapshot rather than being fetched per step,
        so a single request cannot see two different answers for the same player.
        """
        teams = await self.teams_repo.list_by_session(session, draft_session.id)
        players = await self.players_repo.list_by_session(session, draft_session.id, options=loaders.player_options())
        picks = await self.picks_repo.list_by_session(session, draft_session.id)
        return DraftSnapshot(
            teams=tuple(teams),
            players=tuple(players),
            picks=tuple(picks),
            rosters=await self.rosters.load(session, draft_session, players),
        )

    async def resolve_shape(self, session: AsyncSession, draft_session: DraftSession) -> RosterShape:
        """The roster shape this draft's teams must fill.

        The single place that knows which ids a draft resolves its shape from, so
        callers never re-derive the tournament/workspace precedence. Both levels are
        cache-backed, so calling this per request step is cheap.
        """
        return await get_effective_roster_shape(
            session,
            tournament_id=draft_session.tournament_id,
            workspace_id=draft_session.workspace_id,
        )

    async def state_from_snapshot(
        self,
        session: AsyncSession,
        draft_session: DraftSession,
        snapshot: DraftSnapshot,
    ) -> DraftFeasibilityState:
        """Translate an already-loaded snapshot into the matching input."""
        return build_feasibility_state(
            shape=await self.resolve_shape(session, draft_session),
            teams=snapshot.teams,
            players=snapshot.players,
            picks=snapshot.picks,
            rosters=snapshot.rosters,
        )

    async def load_feasibility_state(self, session: AsyncSession, draft_session: DraftSession) -> DraftFeasibilityState:
        return await self.state_from_snapshot(session, draft_session, await self.load_snapshot(session, draft_session))

    async def analyze_session(
        self,
        session: AsyncSession,
        draft_session: DraftSession,
        *,
        hypothetical: DraftAssignment | None = None,
        state: DraftFeasibilityState | None = None,
    ) -> DraftFeasibilityReport:
        if state is None:
            state = await self.load_feasibility_state(session, draft_session)
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
        self,
        session: AsyncSession,
        draft_session: DraftSession,
        *,
        team_id: int,
        state: DraftFeasibilityState | None = None,
    ) -> tuple[DraftPickOption, ...]:
        if state is None:
            state = await self.load_feasibility_state(session, draft_session)
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


feasibility_service = DraftFeasibilityService()
