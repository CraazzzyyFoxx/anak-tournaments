from fastapi import APIRouter, Depends, Form, HTTPException, Request, UploadFile
from faststream.rabbit.fastapi import RabbitRouter
from loguru import logger
from shared.clients.s3 import S3Client
from shared.messaging.config import (
    DISCORD_COMMANDS_QUEUE,
    PROCESS_TOURNAMENT_LOGS_QUEUE,
)
from sqlalchemy import select
from shared.models.log_processing import LogProcessingSource
from shared.schemas.events import (
    DiscordCommandEvent,
    ProcessTournamentLogsEvent,
)

from src import models
from src.core import auth, config, db, enums
from src.services.match_logs import flows as logs_flows
from src.services.match_logs import log_records as record_service
from src.services.s3 import service as s3_service
from src.services.tournament import flows as tournaments_flows
from src.services.tournament import service as tournaments_service


def get_s3(request: Request) -> S3Client:
    return request.app.state.s3

router = APIRouter(
    prefix="/logs",
    tags=[enums.RouteTag.LOGS],
    dependencies=[Depends(auth.require_role_or_service_scope("admin", "parser:logs"))],
)
task_router = RabbitRouter(config.settings.broker_url, logger=logger)


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
async def get_tournament_logs(tournament_id: int, session=Depends(db.get_async_session), s3: S3Client = Depends(get_s3)):
    tournament = await tournaments_flows.get(session, tournament_id, [])
    logs = await s3_service.get_logs_by_tournament(s3, tournament.id)
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
    discord_username: str | None = Form(None),
    session=Depends(db.get_async_session),
    auth_user: models.AuthUser | None = Depends(auth.get_current_user_optional),
    s3: S3Client = Depends(get_s3),
):
    if file.filename is None:
        raise HTTPException(status_code=400, detail="No file name provided")

    decoded_lines = decode_file_lines(file)
    tournament = await tournaments_flows.get(session, tournament_id, [])
    state = await s3_service.upload_log(s3, tournament.id, file.filename, decoded_lines)
    if not state:
        raise HTTPException(status_code=400, detail="Failed to upload file")

    # Resolve uploader game User and source
    uploader_user_id: int | None = None
    if discord_username:
        source = LogProcessingSource.discord
        discord_link = await session.execute(
            select(models.UserDiscord).where(models.UserDiscord.name == discord_username).limit(1)
        )
        discord_user = discord_link.scalar_one_or_none()
        if discord_user:
            uploader_user_id = discord_user.user_id
    elif auth_user:
        source = LogProcessingSource.upload
        player_link = await session.execute(
            select(models.AuthUserPlayer).where(models.AuthUserPlayer.auth_user_id == auth_user.id).limit(1)
        )
        auth_player = player_link.scalar_one_or_none()
        if auth_player:
            uploader_user_id = auth_player.player_id
    else:
        source = LogProcessingSource.manual

    await record_service.upsert_log_record(
        session,
        tournament_id=tournament.id,
        filename=file.filename,
        source=source,
        uploader_id=uploader_user_id,
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
async def process_match_log(tournament_id: int, filename: str, session=Depends(db.get_async_session), s3: S3Client = Depends(get_s3)):
    await logs_flows.process_match_log(session, tournament_id, filename, s3, is_raise=True)
    return {"message": f"Match log '{filename}' for tournament {tournament_id} processed successfully."}


