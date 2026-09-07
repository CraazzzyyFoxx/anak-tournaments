"""RabbitMQ consumer for AchievementEvaluateEvent.

This module provides the subscriber handler that should be registered
on the parser-service worker's broker.
"""

from __future__ import annotations

import uuid

from loguru import logger

from shared.models.achievements.achievement import EvaluationRunTrigger
from shared.observability.correlation import correlation_id_ctx
from shared.schemas.events import AchievementEvaluateEvent
from src.core import db

from .runner import resume_queued_run, run_evaluation


async def handle_achievement_evaluate(data: dict) -> None:
    """Process an AchievementEvaluateEvent from the queue."""
    correlation_id_ctx.set(str(uuid.uuid4()))
    event = AchievementEvaluateEvent.model_validate(data)
    logger.bind(
        workspace_id=event.workspace_id,
        tournament_id=event.tournament_id,
    ).info("Processing achievement evaluation from queue")

    # run_evaluation already logs the traceback with the run id before re-raising,
    # and FastStream logs it a third time through its logger proxy. Logging here
    # too meant one failure produced three Sentry entries for the same event, so
    # let the exception propagate untouched: FastStream rejects the message
    # (AckPolicy.REJECT_ON_ERROR, requeue=False) straight into
    # achievement_evaluate.dlq.
    async with db.async_session_maker() as session:
        await run_evaluation(
            session=session,
            workspace_id=event.workspace_id,
            trigger=EvaluationRunTrigger.parse_complete,
            tournament_id=event.tournament_id,
            changed_tables=event.changed_tables,
        )


async def handle_achievement_evaluate_deferred(data: dict) -> None:
    """Run an evaluation that the tier gate parked on the deferred queue.

    Resumes the ``queued`` run row the caller was already handed instead of
    calling ``run_evaluation`` again — that would re-check the tier and re-queue
    the same workspace forever.
    """
    correlation_id_ctx.set(str(uuid.uuid4()))
    event = AchievementEvaluateEvent.model_validate(data)
    logger.bind(
        workspace_id=event.workspace_id,
        run_id=event.run_id,
    ).info("Processing deferred achievement evaluation from queue")

    async with db.async_session_maker() as session:
        await resume_queued_run(session, event)
