import uuid

from fastapi import APIRouter, Depends, HTTPException, UploadFile
from faststream.rabbit.fastapi import RabbitRouter
from loguru import logger
from shared.messaging.config import (
    DISCORD_COMMANDS_QUEUE,
    PROCESS_MATCH_LOG_QUEUE,
    PROCESS_TOURNAMENT_LOGS_QUEUE,
)
from shared.models.log_processing import LogProcessingSource
from shared.observability.correlation import correlation_id_ctx
from shared.schemas.events import (
    DiscordCommandEvent,
    ProcessMatchLogEvent,
    ProcessTournamentLogsEvent,
)

from src import models
from src.core import auth, config, db, enums
from src.services.match_logs import flows as logs_flows
from src.services.match_logs import log_records as record_service
from src.services.s3 import service as s3_service
from src.services.tournament import flows as tournaments_flows
from src.services.tournament import service as tournaments_service

router = APIRouter(
    prefix="/logs",
    tags=[enums.RouteTag.LOGS],
    dependencies=[Depends(auth.require_role_or_service_scope("admin", "parser:logs"))],
)
task_router = RabbitRouter(config.settings.broker_url, logger=logger)
publisher = task_router.publisher(PROCESS_MATCH_LOG_QUEUE, title="Logs")


def decode_file_lines(uploaded_file: UploadFile) -> bytes:
    file_lines = uploaded_file.file.readlines()
    return "".join([line.decode() for line in file_lines]).encode("utf-8")


@router.post("/")
async def process_all_logs(session=Depends(db.get_async_session)):
    tournaments = await tournaments_service.get_all(session)
    for tournament in tournaments:
        if tournament.id > 20:
            event = ProcessTournamentLogsEvent(tournament_id=tournament.id)
            await task_router.broker.publish(event.model_dump(), PROCESS_TOURNAMENT_LOGS_QUEUE)
    return {"message": "Processing all logs for all tournaments"}


@router.get("/{tournament_id}")
async def get_tournament_logs(tournament_id: int, session=Depends(db.get_async_session)):
    tournament = await tournaments_flows.get(session, tournament_id, [])
    logs = await s3_service.async_client.get_logs_by_tournament(tournament.id)
    return {"tournament": tournament.name, "logs": logs}


@router.post("/{tournament_id}")
async def process_tournament_logs(tournament_id: int, session=Depends(db.get_async_session)):
    tournament = await tournaments_flows.get(session, tournament_id, [])
    event = ProcessTournamentLogsEvent(tournament_id=tournament.id)
    await task_router.broker.publish(event.model_dump(), PROCESS_TOURNAMENT_LOGS_QUEUE)
    return {"message": f"Processing all logs for tournament '{tournament.name}'"}


@router.post("/{tournament_id}/upload")
async def process_logs_async(
    tournament_id: int,
    file: UploadFile,
    session=Depends(db.get_async_session),
    user: models.AuthUser | None = Depends(auth.get_current_user_optional),
):
    if file.filename is None:
        raise HTTPException(status_code=400, detail="No file name provided")

    decoded_lines = decode_file_lines(file)
    tournament = await tournaments_flows.get(session, tournament_id, [])
    state = await s3_service.async_client.upload_log(tournament.id, file.filename, decoded_lines)
    if not state:
        raise HTTPException(status_code=400, detail="Failed to upload file")

    await record_service.upsert_log_record(
        session,
        tournament_id=tournament.id,
        filename=file.filename,
        source=LogProcessingSource.upload,
        uploader_id=user.id if user else None,
    )
    return {"message": "Logs uploaded successfully"}


@router.post("/{tournament_id}/discord")
async def process_logs_discord(tournament_id: int, session=Depends(db.get_async_session)):
    tournament = await tournaments_flows.get(session, tournament_id, [])
    event = DiscordCommandEvent(
        action="process_all",
        tournament_id=tournament_id,
    )
    await task_router.broker.publish(event.model_dump(), DISCORD_COMMANDS_QUEUE)
    return {"message": f"Processing all logs for tournament '{tournament.name}'"}


@router.post("/{tournament_id}/discord/{channel_id}/{message_id}")
async def process_logs_discord_message(
    tournament_id: int,
    channel_id: int,
    message_id: int,
    session=Depends(db.get_async_session),
):
    tournament = await tournaments_flows.get(session, tournament_id, [])
    event = DiscordCommandEvent(
        action="process_message",
        channel_id=channel_id,
        message_id=message_id,
        tournament_id=tournament.id,
    )
    await task_router.broker.publish(event.model_dump(), DISCORD_COMMANDS_QUEUE)
    return {"message": f"Processing message {message_id} in channel {channel_id} for tournament '{tournament.name}'"}


@router.post("/{tournament_id}/{filename}")
async def process_match_log(tournament_id: int, filename: str, session=Depends(db.get_async_session)):
    await logs_flows.process_match_log(session, tournament_id, filename, is_raise=True)
    return {"message": f"Match log '{filename}' for tournament {tournament_id} processed successfully."}


@publisher
@task_router.subscriber(PROCESS_MATCH_LOG_QUEUE)
async def process_match_log_async(data: dict):
    # Generate a correlation ID for this consumer invocation so all log lines
    # emitted during processing of this message share a traceable ID.
    correlation_id_ctx.set(str(uuid.uuid4()))
    event = ProcessMatchLogEvent.model_validate(data)
    logger.bind(tournament_id=event.tournament_id, filename=event.filename).info("Processing match log from queue")
    try:
        async with db.async_session_maker() as session:
            await logs_flows.process_match_log(session, event.tournament_id, event.filename, is_raise=True)
    except Exception:
        # Re-raise so FastStream nacks the message; with x-dead-letter-exchange configured
        # on PROCESS_MATCH_LOG_QUEUE, the message will be routed to process_match_log.dlq.
        logger.exception(f"Failed to process match log tournament_id={event.tournament_id} filename={event.filename}")
        raise


@publisher
@task_router.subscriber(PROCESS_TOURNAMENT_LOGS_QUEUE)
async def process_tournament_log(data: dict):
    # Generate a correlation ID for this consumer invocation.
    correlation_id_ctx.set(str(uuid.uuid4()))
    event = ProcessTournamentLogsEvent.model_validate(data)
    logger.bind(tournament_id=event.tournament_id).info("Processing tournament logs from queue")
    try:
        async with db.async_session_maker() as session:
            tournament = await tournaments_flows.get(session, event.tournament_id, [])

            for log in await s3_service.async_client.get_logs_by_tournament(tournament.id):
                await logs_flows.process_match_log(session, tournament.id, log, is_raise=False)

        logger.info(f"All logs for tournament {event.tournament_id} are queued for processing.")
    except Exception:
        logger.exception(f"Failed to process tournament logs tournament_id={event.tournament_id}")
        raise
