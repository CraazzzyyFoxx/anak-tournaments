"""Per-game result confirmation: one claim per participation for ONE position,
reconciled the moment the last one arrives.

A claim is not "my side's score": it is what the claimant says the WHOLE game
ended on -- one ``game_claim_result`` row per participation in it -- so a lobby
of N claims exactly the way a duel does. Unanimity among the live participations
accepts the result with source ``captain_agreement``; a contradiction marks the
position ``disputed`` and leaves every claim standing for an organizer.

``basis_version`` is the ``game.result_version`` the claimant was looking at. A
claim filed against a superseded result is stale, not a competing truth, so it
is refused (``stale_state``) instead of overwriting the correction that moved
the game underneath it.

No ``stats.match`` row is written here, and none is read: that table records
what a parsed log OBSERVED, while an ``EncounterGame`` records what the
tournament DECIDED.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field

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
from shared.models.encounter.claim import EncounterGameClaim, EncounterGameClaimResult
from shared.models.encounter.game import EncounterGame
from shared.repository import EncounterGameClaimRepository
from shared.services.encounter.participants import active_teams
from shared.services.encounter.result import lock_encounter
from shared.services.realtime import Resource, Scope, emit
from src.services.bracket.usability import is_encounter_live
from src.services.encounter.dispute_review import notify_dispute
from src.services.encounter.games import (
    EncounterGameService,
    GameResultIn,
    encounter_game_service,
    normalize_results,
    require_filled_seats,
)
from src.services.encounter.realtime_commit import emit_pick_ban_update
from src.services.encounter.room_journal import record_room_event
from src.services.encounter.settle import enqueue_challonge_push

__all__ = ("ClaimResultIn", "GameClaimService", "map_report_service")


@dataclass(frozen=True, slots=True)
class ClaimResultIn:
    """One participation's numbers inside one claim."""

    encounter_team_id: int
    score: int | None = None
    placement: int | None = None
    column_values: Mapping[str, float] = field(default_factory=dict)


def _result_locked(message: str) -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_409_CONFLICT,
        detail=[ApiExc(code="result_locked", msg=message)],
    )


class GameClaimService:
    """The mid-series, per-game half of participant reporting."""

    def __init__(
        self,
        *,
        claim_repo: EncounterGameClaimRepository = EncounterGameClaimRepository(),
        games: EncounterGameService = encounter_game_service,
    ) -> None:
        self.claim_repo = claim_repo
        self.games = games

    async def submit_game_claim(
        self,
        session: AsyncSession,
        game_id: int,
        *,
        claimant_team_id: int,
        reporter_user_id: int | None,
        results: Sequence[ClaimResultIn],
        basis_version: int,
        actor_auth_user_id: int | None = None,
    ) -> dict:
        """Upsert ``claimant_team_id``'s claim for one game; reconcile when every
        live participation has claimed.

        Returns ``{"disputed": bool, "resolved": bool, "game": dict}``. Commits:
        the claim, the accepted result and the standing it moves are one
        decision, and half of it is worse than none of it.
        """
        game = await self.games.game_repo.get(session, game_id)
        if game is None or game.state == EncounterGameState.CANCELLED:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Game not found")
        # Encounter first, then the game: every result path takes the two locks
        # in this order, so two captains filing at once queue rather than
        # deadlock. The re-read of the game under its own lock is what makes
        # ``basis_version`` meaningful.
        encounter = await lock_encounter(session, game.encounter_id)
        game = await self.games.game_repo.get_for_update(session, game_id)
        if game is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Game not found")

        if not await is_encounter_live(session, encounter):
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Stage bracket is a preview and is not active yet; wait for the organizer to activate it",
            )
        # A claim is a game STARTING, so the side it is played on has to be
        # decided first.
        await self.games.assert_side_settled(session, encounter, game)
        if encounter.result_status == EncounterResultStatus.CONFIRMED:
            # A confirmed encounter has a standing somebody decided -- the
            # series report, an admin, an import, or the games themselves
            # finishing the card. Any further game claim contradicts it, so it
            # is refused rather than silently filed against a settled result.
            raise _result_locked("This encounter's result is already confirmed; ask an organizer to reopen it")
        if game.state == EncounterGameState.CONFIRMED:
            raise _result_locked("This game's result is already accepted; ask an organizer to correct it")
        if basis_version != game.result_version:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=[
                    ApiExc(
                        code="stale_state",
                        msg=f"This game has moved on (version {game.result_version}); reload before reporting",
                    )
                ],
            )

        seats = await active_teams(session, encounter.id)
        live = {seat.id for seat in seats}
        if claimant_team_id not in live:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="That participation does not play in this encounter",
            )
        require_filled_seats(encounter, seats)
        rules = await self.games.rules(session, encounter)
        normalized = normalize_results(
            [
                GameResultIn(
                    encounter_team_id=item.encounter_team_id,
                    score=item.score,
                    placement=item.placement,
                    column_values=item.column_values,
                )
                for item in results
            ],
            sorted(live),
            rules,
        )

        claims = list(await self.claim_repo.list_for_game(session, game.id))
        claim = next((row for row in claims if row.claimant_team_id == claimant_team_id), None)
        if claim is None:
            claim = await self.claim_repo.create(
                session,
                EncounterGameClaim(
                    encounter_id=encounter.id,
                    game_id=game.id,
                    claimant_team_id=claimant_team_id,
                    reporter_user_id=reporter_user_id,
                    basis_version=basis_version,
                ),
            )
            claims.append(claim)
        else:
            claim.reporter_user_id = reporter_user_id
            claim.basis_version = basis_version
        await self.claim_repo.replace_results(
            session,
            claim,
            [
                EncounterGameClaimResult(
                    claim_id=claim.id,
                    game_id=game.id,
                    encounter_team_id=line.encounter_team_id,
                    score=line.score,
                    placement=line.placement if any(item.placement is not None for item in results) else None,
                    column_values=dict(line.values),
                )
                for line in normalized
            ],
        )
        await record_room_event(
            session,
            encounter.id,
            action="game_claimed",
            source="captain",
            encounter_team_id=claimant_team_id,
            actor_auth_user_id=actor_auth_user_id,
            data={"position": game.position, "game_id": game.id},
        )
        # Unconditional, before every branch below: the other participants'
        # tiles only flip from "not reported" to "sealed" on this signal, and
        # the FIRST claim -- the one that resolves nothing -- would otherwise
        # commit silently. Both topics, because the room refetches map and hero
        # state together. It is also what stages the room's reconcile pass.
        await emit_pick_ban_update(session, encounter.id)
        await emit_pick_ban_update(session, encounter.id, kind=PickBanKind.HERO.value)
        claimed = {row.claimant_team_id for row in claims}
        by_claim = await self.claim_repo.results_for_claims(session, [row.id for row in claims])
        if not live.issubset(claimed):
            # Still waiting on somebody: the first claim resolves nothing, and
            # saying so is what flips the opponent's tile to "sealed".
            await session.commit()
            return await self._answer(session, game, disputed=False, resolved=False)

        shapes = {self._shape(by_claim[row.id]) for row in claims}
        if len(shapes) > 1:
            if game.state != EncounterGameState.DISPUTED:
                await record_room_event(
                    session,
                    encounter.id,
                    action="game_disputed",
                    source="system",
                    data={"position": game.position, "game_id": game.id},
                )
            game.state = EncounterGameState.DISPUTED
            await notify_dispute(session, encounter, seats=seats, actor_auth_user_id=actor_auth_user_id, game=game)
            await session.commit()
            return await self._answer(session, game, disputed=True, resolved=False)

        await self.games.record_result(
            session,
            encounter,
            game,
            results=[
                GameResultIn(
                    encounter_team_id=row.encounter_team_id,
                    score=row.score,
                    placement=row.placement,
                    column_values=dict(row.column_values or {}),
                )
                for row in by_claim[claim.id]
            ],
            source=EncounterGameResultSource.CAPTAIN_AGREEMENT,
            actor_user_id=None,
        )
        # An AGREED claim moves the encounter's own standing -- the public
        # encounter read is stale the moment this commits.
        await emit(
            session,
            scope=Scope.tournament(encounter.tournament_id),
            invalidates=[Resource.TOURNAMENT_ENCOUNTERS],
            entity_ids={"encounter_ids": [encounter.id]},
        )
        if encounter.result_status == EncounterResultStatus.CONFIRMED:
            await enqueue_challonge_push(session, encounter)
        await session.commit()
        return await self._answer(session, game, disputed=False, resolved=True)

    @staticmethod
    def _shape(rows: Sequence[EncounterGameClaimResult]) -> tuple:
        """What two claims have to agree on, order-independent.

        The whole line, not just a winner: two captains who agree on who won but
        not on the map score disagree about the result that gets stored, and a
        ``points`` rule pays by those numbers.
        """
        return tuple(
            sorted(
                (
                    row.encounter_team_id,
                    row.score,
                    row.placement,
                    tuple(sorted((dict(row.column_values or {})).items())),
                )
                for row in rows
            )
        )

    async def _answer(self, session: AsyncSession, game: EncounterGame, *, disputed: bool, resolved: bool) -> dict:
        lines = (await self.games.lines_by_game(session, [game])).get(game.id) or []
        claims = (await self.games.claim_payloads(session, [game]))[game.id]
        return {"disputed": disputed, "resolved": resolved, "game": self.games.serialize(game, lines, claims)}


map_report_service = GameClaimService()
