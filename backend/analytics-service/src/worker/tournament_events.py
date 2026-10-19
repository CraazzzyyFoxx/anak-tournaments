"""``tournament.state.changed`` consumer: a tournament that completes gets its compute job.

The automatic half of ``rpc.analytics.create_job``, minus the actor (so minus its permission check; create_job
charges no quota either): the same verified-workspace and owner gates, then ``create_analytics_job``, whose row and
``AnalyticsJobRequested`` outbox event commit together. A refusal is an answer, not an error -- an unverified
workspace, a tournament outside its workspace, or an active job (``OneActive``) is logged and acked. That last one is
also what makes a redelivery a no-op while the first job is pending or running. Anything else (a database failure)
propagates and the message dead-letters to ``tournament_state_changed.dlq``; "recalculate" is the manual retry.
"""

from __future__ import annotations

from typing import Any

from faststream.rabbit.annotations import RabbitMessage

from shared.core.enums import TournamentStatus
from shared.core.errors import BaseAPIException
from shared.core.tournament_state import FINISHED_STATUSES
from shared.jobs import JobConflict
from shared.messaging.config import TOURNAMENT_EVENTS_EXCHANGE, TOURNAMENT_STATE_CHANGED_QUEUE
from shared.observability import observe_message_processing
from shared.schemas.events import TournamentStateChangedEvent
from src.core import db
from src.core.jobs import JOB_KIND_COMPUTE, create_analytics_job, require_analytics_owner, require_verified_workspace

__all__ = ("admit_completed_tournament", "register")


async def admit_completed_tournament(session: Any, event: TournamentStateChangedEvent) -> str:
    """Create the compute job a completion asks for; the outcome is for the log."""
    # Un-archiving (archived -> completed) changes no result, so it recomputes nothing.
    if event.new_status != TournamentStatus.COMPLETED or event.old_status in FINISHED_STATUSES:
        return "ignored"
    if event.workspace_id is None:
        return "skipped: no workspace"
    try:
        await require_verified_workspace(session, event.workspace_id)
        await require_analytics_owner(session, event.tournament_id, scope=[event.workspace_id], models_required=False)
        job = await create_analytics_job(
            session,
            workspace_id=event.workspace_id,
            tournament_id=event.tournament_id,
            kind=JOB_KIND_COMPUTE,
            algorithms=None,
            requested_by_user_id=None,
        )
    except BaseAPIException as exc:
        return f"skipped: {exc.detail}"
    except JobConflict as exc:
        return f"skipped: {exc}"
    return f"created job {job.id}"


def register(broker: Any, logger: Any) -> None:
    @broker.subscriber(TOURNAMENT_STATE_CHANGED_QUEUE, exchange=TOURNAMENT_EVENTS_EXCHANGE)
    async def consume_tournament_state_changed(data: dict, msg: RabbitMessage) -> None:
        async with observe_message_processing(
            queue=TOURNAMENT_STATE_CHANGED_QUEUE,
            handler="consume_tournament_state_changed",
            message=msg,
            logger=logger,
        ) as context:
            event = TournamentStateChangedEvent.model_validate(data)
            async with db.async_session_maker() as session:
                outcome = await admit_completed_tournament(session, event)
            context.logger.bind(
                tournament_id=event.tournament_id, workspace_id=event.workspace_id, outcome=outcome
            ).info("tournament.state.changed handled")
