"""A mix lobby's captain draft (spec §9): what a mix hands the tournament draft engine, and what it keeps honest.

The engine runs the draft -- order, clock, autopick, feasibility, rollback. This module decides which lobby, which
seated set and which captains a mix seeds, lets its hosts replace a captain or add a waiting player, and applies the
away policy (§9.5) to a running draft. The lineup a finished draft leaves is ``CustomGameService.write_draft_lineup``.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence

from sqlalchemy.ext.asyncio import AsyncSession

from shared import models
from shared.core import http_status as status
from shared.core.enums import DraftCaptainOrder, DraftPlayerStatus, DraftPoolSource, DraftStatus
from shared.core.errors import BaseAPIException as HTTPException
from shared.domain.roster import PlayerRoster
from shared.domain.roster_shape import RosterShape
from shared.models.draft import DraftPlayer, DraftSession
from shared.repository.draft import DraftPlayerRepository, DraftSessionRepository, DraftTeamRepository
from shared.services.team_format import custom_game_slot_shape
from src.domain.draft import ranks, rules
from src.domain.draft.entities import PoolSeat
from src.services.custom_game import CustomGameService, _refuse_live, custom_game_service
from src.services.draft import realtime as draft_rt
from src.services.draft.feasibility import feasibility_service
from src.services.draft.lifecycle import DraftLifecycleService, lifecycle_service

__all__ = ("MixDraftService", "mix_draft_service")

_SETUP = (DraftStatus.SETUP.value, DraftStatus.READY.value)


class MixDraftService:
    def __init__(
        self,
        *,
        mixes: CustomGameService = custom_game_service,
        lifecycle: DraftLifecycleService = lifecycle_service,
        sessions: DraftSessionRepository = DraftSessionRepository(),
        teams: DraftTeamRepository = DraftTeamRepository(),
        players: DraftPlayerRepository = DraftPlayerRepository(),
    ) -> None:
        self.mixes = mixes
        self.lifecycle = lifecycle
        self.sessions = sessions
        self.teams = teams
        self.players = players

    async def seed_lobby(
        self,
        session: AsyncSession,
        *,
        workspace_id: int,
        custom_game_id: int,
        lobby_index: int,
        actor_user_id: int,
        actor_is_superuser: bool = False,
    ) -> models.CustomGame:
        """Draft (spec §9.2): re-form this lobby as a captain draft over its seated set. 409 ``match_live``."""
        game = await self.mixes._writable(
            session,
            workspace_id=workspace_id,
            custom_game_id=custom_game_id,
            actor_user_id=actor_user_id,
            actor_is_superuser=actor_is_superuser,
        )
        lobby = await self.mixes._lobby(session, game, lobby_index)
        _refuse_live(lobby)
        await self.mixes.cancel_drafts(session, game, [lobby_index])
        pools = await self.mixes.draft_pools(session, game, [lobby_index])
        await self._seed(session, game, lobby, pools[lobby_index])
        return game

    async def split_pool(
        self,
        session: AsyncSession,
        *,
        workspace_id: int,
        custom_game_id: int,
        actor_user_id: int,
        actor_is_superuser: bool = False,
    ) -> models.CustomGame:
        """Split pool (spec §9.2): the seated set split over every lobby by strength, one draft seeded per lobby, no
        team formed. 422 ``single_lobby``; 409 ``match_live`` while any lobby plays."""
        game = await self.mixes._writable(
            session,
            workspace_id=workspace_id,
            custom_game_id=custom_game_id,
            actor_user_id=actor_user_id,
            actor_is_superuser=actor_is_superuser,
        )
        if game.lobby_count < 2:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="single_lobby")
        lobbies = sorted(await self.mixes.lobbies.list_for_game(session, game.id), key=lambda lobby: lobby.lobby_index)
        for lobby in lobbies:
            _refuse_live(lobby)
        await self.mixes.cancel_drafts(session, game, None)
        pools = await self.mixes.draft_pools(session, game, [lobby.lobby_index for lobby in lobbies])
        for lobby in lobbies:
            await self._seed(session, game, lobby, pools[lobby.lobby_index])
        return game

    async def replace_captain(
        self,
        session: AsyncSession,
        *,
        workspace_id: int,
        custom_game_id: int,
        lobby_index: int,
        team_id: int,
        player_id: int,
        actor_user_id: int,
        actor_is_superuser: bool = False,
    ) -> models.CustomGame:
        """Replace captain (spec §9.3, §9.5). Before the start: any pool player, and the draft re-seeds with the
        weaker of the two picking first -- the repair for a captain who stepped away. During it: a player already on
        that team takes over its picks; picks stand. 404 ``draft_not_found``; 409 ``already_captain`` /
        ``not_in_pool``; 422 ``captain_not_on_team``."""
        game, draft = await self._running(
            session, workspace_id, custom_game_id, lobby_index, actor_user_id, actor_is_superuser
        )
        team = await self.lifecycle.get_team(session, draft, team_id)
        seats = list(await self.players.list_by_session(session, draft.id))
        player = next((seat for seat in seats if seat.id == player_id), None)
        if player is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Draft player not found")
        if draft.status in _SETUP:
            pool = await self.lifecycle.rosters.pool(session, draft)
            if player.workspace_member_id not in pool:
                raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="not_in_pool")
            teams = list(await self.teams.list_by_session(session, draft.id))
            captains = [row.captain_workspace_member_id for row in teams]
            if player.workspace_member_id in captains:
                raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="already_captain")
            captains[teams.index(team)] = player.workspace_member_id
            # A re-seed starts over from setup, and whoever stepped away since the seed leaves the pool with it.
            draft.status = DraftStatus.SETUP.value
            await self._reseed(
                session,
                draft,
                captains,
                [seat.workspace_member_id for seat in seats if seat.workspace_member_id in pool],
                pool=pool,
                shape=await custom_game_slot_shape(session, game),
            )
        else:
            if player.drafted_by_team_id != team.id or player.status != DraftPlayerStatus.PICKED.value:
                raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="captain_not_on_team")
            roster = (await self.lifecycle.rosters.load(session, draft, [player])).get(player.id)
            # The seed flag stays on the seat the engine seeded (it has no pick); the team's captain -- who picks,
            # and whom the board crowns -- is this player now.
            team.captain_workspace_member_id = player.workspace_member_id
            team.captain_auth_user_id = roster.auth_user_id if roster is not None else None
            await session.flush()
        await _updated(session, draft, actor_user_id)
        return game

    async def add_player(
        self,
        session: AsyncSession,
        *,
        workspace_id: int,
        custom_game_id: int,
        lobby_index: int,
        workspace_member_id: int,
        actor_user_id: int,
        actor_is_superuser: bool = False,
    ) -> models.CustomGame:
        """The host adds a waiting player to a draft short of a role (spec §9.5) -- before the start too, when a pool
        player stepped away. 404 ``not_on_roster`` / ``draft_not_found``, 409 ``player_away`` / ``already_seated``."""
        game, draft = await self._running(
            session, workspace_id, custom_game_id, lobby_index, actor_user_id, actor_is_superuser
        )
        row = next(
            (
                row
                for row in await self.mixes.roster.list_for_game(session, game.id)
                if row.workspace_member_id == workspace_member_id
            ),
            None,
        )
        if row is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="not_on_roster")
        if row.away:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="player_away")
        pools = await self.mixes.draft_lobbies(session, game.id)
        busy = await self.mixes._other_lobby_seated(session, game, lobby_index) | pools[lobby_index][2]
        if workspace_member_id in busy:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="already_seated")
        await self.players.create_many(
            session,
            [
                DraftPlayer(
                    session_id=draft.id,
                    workspace_member_id=workspace_member_id,
                    status=DraftPlayerStatus.AVAILABLE.value,
                )
            ],
        )
        await _updated(session, draft, actor_user_id)
        return game

    async def on_away(
        self,
        session: AsyncSession,
        *,
        custom_game_id: int,
        workspace_member_id: int,
        away: bool,
        actor_auth_user_id: int,
    ) -> None:
        """Apply the away policy to the member's running draft, if any (spec §9.5). Stepping away while picked -- or
        leaving a pool that can no longer fill every role -- pauses a live draft. Otherwise, a return included, the
        board re-reads: an unpicked player away is no longer draftable, and draftable again once back."""
        for draft in await self.sessions.active_for_custom_game(session, custom_game_id):
            seat = next(
                (
                    seat
                    for seat in await self.players.list_by_session(session, draft.id)
                    if seat.workspace_member_id == workspace_member_id
                ),
                None,
            )
            if seat is None:
                continue
            if (
                away
                and draft.status == DraftStatus.LIVE.value
                and (
                    seat.status == DraftPlayerStatus.PICKED.value
                    or not (await feasibility_service.analyze_session(session, draft)).is_feasible
                )
            ):
                await self.lifecycle.transition(
                    session,
                    draft.id,
                    self.lifecycle.pause,
                    event_type="draft.paused",
                    audit_action="paused",
                    actor_auth_user_id=actor_auth_user_id,
                )
            else:
                await _updated(session, draft, actor_auth_user_id)

    async def _running(
        self,
        session: AsyncSession,
        workspace_id: int,
        custom_game_id: int,
        lobby_index: int,
        actor_user_id: int,
        actor_is_superuser: bool,
    ) -> tuple[models.CustomGame, DraftSession]:
        """The mix, locked, and the lobby's active draft read under that lock."""
        game = await self.mixes._writable(
            session,
            workspace_id=workspace_id,
            custom_game_id=custom_game_id,
            actor_user_id=actor_user_id,
            actor_is_superuser=actor_is_superuser,
        )
        draft = next(
            (
                row
                for row in await self.sessions.active_for_custom_game(session, game.id)
                if row.lobby_index == lobby_index
            ),
            None,
        )
        if draft is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="draft_not_found")
        return game, draft

    async def _seed(
        self, session: AsyncSession, game: models.CustomGame, lobby: models.CustomGameLobby, member_ids: Sequence[int]
    ) -> DraftSession:
        """One lobby's draft over ``member_ids``: the lobby's lineup is cleared (it reads Draft setup until the last
        pick), the two strongest captain, the weaker of them first (spec §9.3)."""
        lobby.balance_result_json = None
        lobby.selected_variant_index = 0
        lobby.balanced_at = None
        shape = await custom_game_slot_shape(session, game)
        draft = await self.lifecycle.create_session(
            session,
            workspace_id=game.workspace_id,
            custom_game_id=game.id,
            lobby_index=lobby.lobby_index,
            shape=shape,
            pool_source=DraftPoolSource.MANUAL.value,
            pick_time_seconds=game.draft_pick_seconds,
        )
        pool = await self.lifecycle.rosters.pool(session, draft)
        strongest = sorted(member_ids, key=lambda member: (-ranks.captain_rank(pool.get(member), None, shape), member))
        await self._reseed(session, draft, strongest[:2], member_ids, pool=pool, shape=shape)
        await _updated(session, draft, None)
        return draft

    async def _reseed(
        self,
        session: AsyncSession,
        draft: DraftSession,
        captains: Sequence[int],
        member_ids: Sequence[int],
        *,
        pool: Mapping[int, PlayerRoster],
        shape: RosterShape,
    ) -> None:
        order = rules.order_captain_ids(
            [(member, ranks.captain_rank(pool.get(member), None, shape)) for member in captains],
            DraftCaptainOrder.WEAKEST_FIRST,
        )
        seats = [
            PoolSeat(None, draft_position=position, workspace_member_id=member)
            for position, member in enumerate(order, start=1)
        ]
        seats += [PoolSeat(None, workspace_member_id=member) for member in member_ids if member not in order]
        await self.lifecycle.seed(session, draft, seats=seats)


async def _updated(session: AsyncSession, draft: DraftSession, actor_user_id: int | None) -> None:
    """The board re-reads its snapshot: seats, captains or the pool changed."""
    await draft_rt.publish_draft_event(
        session,
        draft_session=draft,
        event_type="draft.session_updated",
        payload={"session_id": draft.id, "status": draft.status},
        actor_user_id=actor_user_id,
    )


mix_draft_service = MixDraftService()
