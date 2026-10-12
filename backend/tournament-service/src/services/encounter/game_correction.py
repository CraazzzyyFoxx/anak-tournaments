"""Admin correction of one position's result (spec §6.5 cases 1-3).

A confirmed game is locked against participants -- ``submit_game_claim`` refuses
it with ``result_locked`` -- so this is the only way its numbers ever change,
and it always carries a reason into the result journal.

The hard part is not the numbers: it is what the OLD result already decided.
A correction that changes who won position N changes the encounter's standing,
and a standing is what the bracket advanced on. So when the encounter's result
was already confirmed, the correction is the full sequence Task 5's engine
defines -- ``reopen`` the encounter, ``reset_downstream`` to un-seat and
re-state everything it fed, write the new game result, then
``advance_after_result`` on what the games now say. Anything less leaves a later
round holding a team that no longer won.
"""

from __future__ import annotations

from collections.abc import Sequence

from sqlalchemy.ext.asyncio import AsyncSession

from shared.core import http_status as status
from shared.core.enums import (
    EncounterGameResultSource,
    EncounterGameState,
    EncounterResultStatus,
    PickBanKind,
)
from shared.core.errors import ApiExc
from shared.core.errors import BaseAPIException as HTTPException
from shared.models.encounter.encounter import Encounter
from shared.services.bracket import advancement
from shared.services.encounter.result import lock_encounter, reopen
from src.services.encounter.games import (
    EncounterGameService,
    GameResultIn,
    encounter_game_service,
)
from src.services.encounter.realtime_commit import emit_pick_ban_update
from src.services.notifications.lifecycle import advance_and_announce
from src.services.tournament.events import enqueue_tournament_recalculation

__all__ = ("GameCorrectionService", "game_correction_service")


class GameCorrectionService:
    """The organizer's override of one position's result, and the cascade it
    sometimes owes."""

    def __init__(self, *, games: EncounterGameService = encounter_game_service) -> None:
        self.games = games

    async def correct_game(
        self,
        session: AsyncSession,
        encounter_id: int,
        *,
        game_id: int,
        results: Sequence[GameResultIn],
        actor_user_id: int,
        reason: str,
    ) -> dict:
        """Write ``results`` onto one position as an ADMIN result. Commits.

        Returns ``{"game": ..., "reset_downstream": bool}``.
        """
        if not (reason or "").strip():
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=[ApiExc(code="reason_required", msg="Correcting a result needs a stated reason")],
            )
        # Encounter first, then the game -- the lock order every result path
        # takes, so a captain's claim and this correction queue instead of
        # deadlocking.
        encounter = await lock_encounter(session, encounter_id)
        game = await self.games.game_repo.get_for_update(session, game_id)
        if game is None or game.encounter_id != encounter.id or game.state == EncounterGameState.CANCELLED:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Game not found")

        cascaded = await self._unwind(session, encounter, actor_user_id=actor_user_id, reason=reason)
        await self.games.record_result(
            session,
            encounter,
            game,
            results=results,
            source=EncounterGameResultSource.ADMIN,
            actor_user_id=actor_user_id,
            reason=reason,
        )
        if encounter.result_status == EncounterResultStatus.CONFIRMED:
            await advance_and_announce(session, encounter)
        # A correction moves the encounter's standing and may reseat a whole
        # bracket branch through ``reset_downstream``: every cached
        # tournament-encounters read is stale and the standings have to be
        # rebuilt. ``enqueue_tournament_recalculation`` emits the invalidation
        # and queues the job in one call.
        await enqueue_tournament_recalculation(session, encounter.tournament_id)
        await emit_pick_ban_update(session, encounter.id)
        await emit_pick_ban_update(session, encounter.id, kind=PickBanKind.HERO.value)
        await session.commit()
        lines = (await self.games.lines_by_game(session, [game])).get(game.id) or []
        return {"game": self.games.serialize(game, lines), "reset_downstream": cascaded}

    async def _unwind(self, session: AsyncSession, encounter: Encounter, *, actor_user_id: int, reason: str) -> bool:
        """Take a standing correction back out of the bracket before rewriting it.

        Only when a result was actually standing. ``reopen`` is what un-makes
        the decision (and is why this needs a real actor), and
        ``reset_downstream`` retires the seats it filled, cancels the games
        those seats had not played and re-states every target -- recursively,
        because a correction three rounds up invalidates everything below it.
        """
        if encounter.result_status != EncounterResultStatus.CONFIRMED:
            return False
        await reopen(session, encounter, actor_user_id=actor_user_id, reason=reason)
        await advancement.reset_downstream(session, encounter, actor_user_id=actor_user_id)
        return True


game_correction_service = GameCorrectionService()
