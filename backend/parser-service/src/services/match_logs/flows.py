"""Invalidation and completion triggers a changed observation raises for the tournament side.

Binding, identity resolution and the observation write live in ``src/services/ingest`` (binding/identity/writer/process).
What remains here is the seam they call after a successful replacement: tournament cache invalidation and the
completed-encounter achievement trigger. An awaiting-link job never reaches it.
"""

from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncSession

from shared.messaging.config import TOURNAMENT_EVENTS_EXCHANGE
from shared.messaging.outbox import enqueue_outbox_event
from shared.schemas.events import TournamentStandingsInvalidatedEvent
from shared.services.encounter.events import enqueue_encounter_completed
from shared.services.realtime import Resource, Scope, emit, enqueue_invalidation_outbox
from src import models
from src.core import enums


def _encounter_is_completed(encounter: models.Encounter) -> bool:
    # Single form (encres0001 pins it to result_status == CONFIRMED).
    return encounter.status == enums.EncounterStatus.COMPLETED


async def enqueue_match_scores_changed(session: AsyncSession, tournament_id: int, encounter_id: int) -> None:
    # A parsed log adds or replaces one map's observation under the encounter
    # (``has_logs``, the per-map reads). It does not move the encounter's score:
    # EncounterGame and finalize own that since encgame01. Both halves of the
    # invalidation: emit() for the clients and this service's own caches, the
    # outbox row for tournament-service and app-service, which cache the same
    # reads and cannot rely on Redis pub/sub's at-most-once delivery.
    invalidated = (Resource.TOURNAMENT_ENCOUNTERS, Resource.TOURNAMENT_STANDINGS)
    scope = Scope.tournament(tournament_id)
    await emit(session, scope=scope, invalidates=list(invalidated), entity_ids={"encounter_ids": [encounter_id]})
    await enqueue_invalidation_outbox(session, scope=scope, resources=invalidated)

    await enqueue_outbox_event(
        session,
        TournamentStandingsInvalidatedEvent(
            tournament_id=tournament_id,
            source_service="parser-service",
        ),
        exchange=TOURNAMENT_EVENTS_EXCHANGE,
        routing_key="tournament.standings.invalidated",
    )


async def _enqueue_match_log_tournament_events(
    session: AsyncSession,
    encounter: models.Encounter,
) -> None:
    await enqueue_match_scores_changed(session, encounter.tournament_id, encounter.id)

    if not _encounter_is_completed(encounter):
        return

    await enqueue_encounter_completed(session, encounter, source_service="parser-service")
