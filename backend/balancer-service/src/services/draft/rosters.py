"""The draft's only door to roles and ranks.

One call per request resolves every seated registration through the engine
(``shared.services.roster``) and keys the answer by ``DraftPlayer.id``, so the
board, feasibility, the pick options, autopick and the team export all read the
same numbers -- the numbers the balancer shows -- and none of them derives
anything.

Nothing here caches across requests: the point of deleting the draft's roles
snapshot was that a cache is exactly what went stale.
"""

from __future__ import annotations

from collections.abc import Collection

from sqlalchemy.ext.asyncio import AsyncSession

from shared.domain.roster import PlayerRoster
from shared.models.balancer.draft import DraftPlayer, DraftSession
from shared.services.roster import RosterEngine, roster_engine

__all__ = ("DraftRosterService", "draft_rosters")


class DraftRosterService:
    def __init__(self, *, engine: RosterEngine = roster_engine) -> None:
        self.engine = engine

    async def load(
        self,
        session: AsyncSession,
        draft_session: DraftSession,
        players: Collection[DraftPlayer],
    ) -> dict[int, PlayerRoster]:
        """``{draft_player.id: PlayerRoster}`` for the given seats.

        ``include_deleted``: a registration soft-deleted mid-draft still has to
        render on the board and keep its frozen picks readable -- dropping it
        here would make an already-picked player vanish from a roster.
        """
        if not players:
            return {}
        by_registration = await self.engine.for_tournament(
            session,
            draft_session.tournament_id,
            registration_ids=sorted({player.registration_id for player in players}),
            include_deleted=True,
        )
        return {
            player.id: by_registration[player.registration_id]
            for player in players
            if player.registration_id in by_registration
        }

    async def pool(self, session: AsyncSession, tournament_id: int) -> dict[int, PlayerRoster]:
        """The balancer pool, resolved -- what a seed may seat, keyed by registration."""
        return await self.engine.for_tournament(session, tournament_id, pool_only=True)


draft_rosters = DraftRosterService()
