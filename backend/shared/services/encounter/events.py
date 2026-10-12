"""Encounter lifecycle events that more than one service emits.

``EncounterCompletedEvent`` drives achievement and MVP-impact recalculation. It
used to be emitted only by tournament-service, so a result arriving through the
Challonge importer in parser-service silently skipped both — the same result
entered by an admin did not. The derivation lives here so neither service can
drift from the other again.
"""

from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncSession

from shared.messaging.config import TOURNAMENT_EVENTS_EXCHANGE
from shared.messaging.outbox import enqueue_outbox_event
from shared.models.encounter.encounter import Encounter
from shared.schemas.events import EncounterCompletedEvent
from shared.services.encounter.participants import active_teams

__all__ = ("enqueue_encounter_completed",)


async def enqueue_encounter_completed(
    session: AsyncSession,
    encounter: Encounter,
    *,
    source_service: str,
) -> None:
    """Queue the completion event for an encounter that just reached COMPLETED.

    The winner is the sole first place among the active participations: a
    shared first place is nobody's win, which is what a drawn series is. Read
    off the materialized standing rather than a score comparison, so a lobby of
    N announces its winner the same way a duel does.

    Goes through the outbox, so it lands in the caller's transaction: a result
    that rolls back never announces itself.
    """
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
        routing_key="tournament.encounter.completed",
    )
