"""Encounter lifecycle events that more than one service emits.

``EncounterCompletedEvent`` drives achievement and MVP-impact recalculation, and
a result can arrive through tournament-service or through stats-service's
Challonge importer: the derivation lives here so the two cannot drift.
"""

from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncSession

from shared.messaging.config import TOURNAMENT_ENCOUNTER_COMPLETED_QUEUE, TOURNAMENT_EVENTS_EXCHANGE
from shared.messaging.outbox import enqueue_outbox_event
from shared.models.encounter.encounter import Encounter
from shared.schemas.events import EncounterCompletedEvent
from shared.services.encounter.participants import active_teams
from shared.services.scrim_scope import is_scrim_container

__all__ = ("enqueue_encounter_completed",)


async def enqueue_encounter_completed(
    session: AsyncSession,
    encounter: Encounter,
    *,
    source_service: str,
) -> None:
    """Queue the completion event for an encounter that just reached COMPLETED — unless it is a scrim room.

    The event's one consumer evaluates achievements, and for a scrim that is
    verifiably empty: every achievement condition reaches its users through an
    inner join on ``Player`` or through native player facts, and a scrim room
    has neither. Publishing would still cost an outbox row, a queue round trip,
    an ``EvaluationRun`` audit row and one query per encounter-dependent rule.

    The winner is the sole first place among the active participations: a
    shared first place is nobody's win, which is what a drawn series is. Read
    off the materialized standing rather than a score comparison, so a lobby of
    N announces its winner the same way a duel does.

    Goes through the outbox, so it lands in the caller's transaction: a result
    that rolls back never announces itself.
    """
    if await is_scrim_container(session, encounter.tournament_id):
        return
    first = [seat for seat in await active_teams(session, encounter.id) if seat.placement == 1]
    winner = first[0] if len(first) == 1 else None

    await enqueue_outbox_event(
        session,
        EncounterCompletedEvent(
            tournament_id=encounter.tournament_id,
            encounter_id=encounter.id,
            winner_team_id=None if winner is None else winner.team_id,
            source_service=source_service,
        ),
        exchange=TOURNAMENT_EVENTS_EXCHANGE,
        routing_key=TOURNAMENT_ENCOUNTER_COMPLETED_QUEUE.routing_key,
    )
