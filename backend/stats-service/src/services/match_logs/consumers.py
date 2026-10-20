"""The worker's match-log consumers: Discord uploads, the tournament-wide reprocess fan-out, completed encounters."""

from __future__ import annotations

import base64
import time
from typing import Any

from faststream.rabbit import Channel
from faststream.rabbit.annotations import RabbitMessage

from shared.messaging.config import (
    ACHIEVEMENT_EVALUATE_QUEUE,
    PROCESS_TOURNAMENT_LOGS_QUEUE,
    TOURNAMENT_ENCOUNTER_COMPLETED_QUEUE,
    TOURNAMENT_EVENTS_EXCHANGE,
    UPLOAD_MATCH_LOG_QUEUE,
    ingest_replay_queue,
)
from shared.messaging.outbox import enqueue_outbox_event
from shared.messaging.topology import declare_replay_queues, publish_required
from shared.observability import observe_message_processing
from shared.repository import TournamentRepository
from shared.schemas.events import (
    AchievementEvaluateEvent,
    EncounterCompletedEvent,
    ProcessIngestJobEvent,
    ProcessTournamentLogsEvent,
    UploadMatchLogEvent,
)
from src.core import config, db
from src.core.clients import s3_client
from src.services.match_logs import flows as logs_flows
from src.services.match_logs.limits import max_base64_length
from src.services.match_logs.log_records import log_records_service
from src.services.match_logs.objectiveless import load_producers, resolve_encounter_maps
from src.services.match_logs.result_events import publish_match_log_result
from src.services.match_logs.uploads import upload_service

__all__ = (
    "process_tournament_encounter_completed",
    "process_tournament_log",
    "process_upload_match_log",
    "register",
)

_tournaments = TournamentRepository()


async def process_upload_match_log(data: dict, msg: RabbitMessage, *, broker: Any, logger: Any) -> None:
    """Hash/store actual bytes, create or reuse a native job and commit its ingest request carrying the upload's ids."""
    async with observe_message_processing(
        queue=UPLOAD_MATCH_LOG_QUEUE,
        handler="process_upload_match_log",
        message=msg,
        logger=logger,
    ):
        event = UploadMatchLogEvent.model_validate(data)
        log = logger.bind(tournament_id=event.tournament_id, filename=event.filename)
        try:
            if len(event.content_b64) > max_base64_length(config.settings.max_match_log_bytes):
                raise ValueError("Match log exceeds the upload size limit")
            content = base64.b64decode(event.content_b64, validate=True)
            async with db.async_session_maker() as session:
                uploader_user_id = None
                if event.uploader_discord_name:
                    uploader_user_id = await upload_service.resolve_discord_uploader_id(
                        session, event.uploader_discord_name
                    )
                await upload_service.store_uploaded_log_bytes(
                    session,
                    s3=s3_client,
                    tournament_id=event.tournament_id,
                    filename=event.filename,
                    content=content,
                    source="discord" if event.uploader_discord_name else "manual",
                    uploader_id=uploader_user_id,
                    correlation_id=event.correlation_id,
                    channel_id=event.channel_id,
                    message_id=event.message_id,
                )
        except Exception as exc:
            # No job was committed: this is the uploader's only answer.
            await publish_match_log_result(
                broker,
                event.tournament_id,
                event.filename,
                "failed",
                correlation_id=event.correlation_id,
                error_message=str(exc),
                channel_id=event.channel_id,
                message_id=event.message_id,
                logger=log,
            )
            log.exception("Failed to upload or queue match log")


async def process_tournament_log(data: dict, msg: RabbitMessage, *, broker: Any, logger: Any) -> None:
    """Re-pend a tournament's logs and ask the discipline's replay queue to reparse each done one."""
    async with observe_message_processing(
        queue=PROCESS_TOURNAMENT_LOGS_QUEUE,
        handler="process_tournament_log",
        message=msg,
        logger=logger,
    ):
        event = ProcessTournamentLogsEvent.model_validate(data)
        logger.bind(tournament_id=event.tournament_id).info("Processing tournament logs from queue")
        try:
            # Re-pended jobs are committed with their ingest requests in the outbox (the PENDING transition stages them).
            async with db.async_session_maker() as session:
                requeued = await log_records_service.requeue_tournament(session, event.tournament_id)
            # Done jobs are never re-pended: each is replayed through the discipline's TTL-less replay queue with the revision
            # seen at selection, so a log superseded or re-replaced in the meantime reports stale instead of winning.
            # This consumer never decodes: only a worker serving the job's discipline can.
            if requeued.replay:
                # The destination may not exist yet (no worker of that discipline has started on a fresh broker), and an
                # unroutable publish must fail this request rather than drop the reparses.
                await declare_replay_queues(broker, requeued.discipline)
            for job_id, revision in requeued.replay.items():
                await publish_required(
                    broker,
                    ingest_replay_queue(requeued.discipline),
                    ProcessIngestJobEvent(ingest_job_id=job_id, reparse_expected_revision=revision).model_dump_json(),
                )
            logger.info(
                "Tournament {} logs: {} queued, {} replays requested",
                event.tournament_id,
                len(requeued.queue),
                len(requeued.replay),
            )
        except Exception:
            logger.exception(f"Failed to process tournament logs tournament_id={event.tournament_id}")
            raise


async def process_tournament_encounter_completed(data: dict, msg: RabbitMessage, *, logger: Any) -> None:
    """Resolve the encounter's undecided maps, then ask for the achievement run its completion makes due."""
    async with observe_message_processing(
        queue=TOURNAMENT_ENCOUNTER_COMPLETED_QUEUE,
        handler="process_tournament_encounter_completed",
        message=msg,
        logger=logger,
    ):
        event = EncounterCompletedEvent.model_validate(data)
        async with db.async_session_maker() as session:
            workspace_id = await _tournaments.get_workspace_id(session, event.tournament_id)
            if workspace_id is None:
                raise RuntimeError(f"Tournament {event.tournament_id} not found")
            # Before the achievement run below: it reads per-map winners, and a
            # completed series is what decides a Push/Clash map by exclusion.
            producers = await load_producers(session, s3_client, event.encounter_id)
            if await resolve_encounter_maps(session, event.encounter_id, producers=producers):
                await logs_flows.enqueue_match_scores_changed(session, event.tournament_id, event.encounter_id)
            await enqueue_outbox_event(
                session,
                AchievementEvaluateEvent(
                    # Unique per delivery, not per completion: a redelivered completion must not hit
                    # event_outbox.event_id's UNIQUE and dead-letter a message whose work is already committed.
                    event_id=f"achievement:{workspace_id}:{event.tournament_id}:encounter:{event.encounter_id}:"
                    f"{int(time.time() * 1000)}",
                    workspace_id=workspace_id,
                    tournament_id=event.tournament_id,
                    changed_tables=["tournament.encounter", "stats.fact"],
                    source_service="stats-service",
                ),
                exchange="",
                routing_key=ACHIEVEMENT_EVALUATE_QUEUE.name,
            )
            await session.commit()


def register(broker: Any, logger: Any, *, channel: Channel) -> None:
    """Subscribe the upload and tournament fan-out consumers on ``channel`` (the worker's short-handler channel)."""

    @broker.subscriber(UPLOAD_MATCH_LOG_QUEUE, channel=channel)
    async def upload_match_log(data: dict, msg: RabbitMessage) -> None:
        await process_upload_match_log(data, msg, broker=broker, logger=logger)

    @broker.subscriber(PROCESS_TOURNAMENT_LOGS_QUEUE, channel=channel)
    async def tournament_logs(data: dict, msg: RabbitMessage) -> None:
        await process_tournament_log(data, msg, broker=broker, logger=logger)

    @broker.subscriber(TOURNAMENT_ENCOUNTER_COMPLETED_QUEUE, exchange=TOURNAMENT_EVENTS_EXCHANGE)
    async def encounter_completed(data: dict, msg: RabbitMessage) -> None:
        await process_tournament_encounter_completed(data, msg, logger=logger)
