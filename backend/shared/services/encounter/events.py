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
from shared.models.tournament.encounter import Encounter
from shared.schemas.events import EncounterCompletedEvent

__all__ = ("enqueue_encounter_completed",)


async def enqueue_encounter_completed(
    session: AsyncSession,
    encounter: Encounter,
    *,
    source_service: str,
) -> None:
    """Queue the completion event for an encounter that just reached COMPLETED.

    Goes through the outbox, so it lands in the caller's transaction: a result
    that rolls back never announces itself.
    """
    winner_team_id: int | None = None
    if encounter.home_score > encounter.away_score:
        winner_team_id = encounter.home_team_id
    elif encounter.away_score > encounter.home_score:
        winner_team_id = encounter.away_team_id

    await enqueue_outbox_event(
        session,
        EncounterCompletedEvent(
            tournament_id=encounter.tournament_id,
            encounter_id=encounter.id,
            home_team_id=encounter.home_team_id,
            away_team_id=encounter.away_team_id,
            winner_team_id=winner_team_id,
            source_service=source_service,
        ),
        exchange=TOURNAMENT_EVENTS_EXCHANGE,
        routing_key="tournament.encounter.completed",
    )
