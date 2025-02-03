from fastapi import APIRouter, Depends, UploadFile, HTTPException
from faststream.redis.fastapi import RedisRouter
from loguru import logger
from src.core import db, enums, config
from src.services.tournament import flows as tournaments_flows
from src.services.s3 import service as s3_service
from src.services.auth import flows as auth_flows
from . import flows

PROCESS_MATCH_LOGS_TOPIC = "process_match_logs"

router = APIRouter(
    prefix="/logs",
    tags=[enums.RouteTag.LOGS],
    dependencies=[Depends(auth_flows.current_user)],
)
task_router = RedisRouter(config.app.celery_broker_url.unicode_string(), logger=logger)
publisher = task_router.publisher(PROCESS_MATCH_LOGS_TOPIC, title="Logs")


def decode_file_lines(uploaded_file: UploadFile) -> list[str]:
    file_lines = uploaded_file.file.readlines()
    return [line.decode() for line in file_lines]


@router.post("/{tournament_id}/process")
async def process_logs(
    tournament_id: int,
    file: UploadFile,
    session=Depends(db.get_async_session),
):
    if file.filename is None:
        raise HTTPException(status_code=400, detail="No file name provided")

    decoded_lines = decode_file_lines(file)
    tournament = await tournaments_flows.get(session, tournament_id, [])
    processor = flows.MatchLogProcessor(tournament, file.filename, decoded_lines)
    await processor.start(session, is_raise=True)
    return {"message": "Logs processed successfully"}


@router.post("/{tournament_id}/async/process")
async def process_logs_async(tournament_id: int, filename: str):
    await task_router.broker.publish(
        {"tournament_id": tournament_id, "filename": filename}, PROCESS_MATCH_LOGS_TOPIC
    )
    return {"message": f"Async processing initiated for file '{filename}'"}


@router.get("/{tournament_id}")
async def get_tournament_logs(
    tournament_id: int, session=Depends(db.get_async_session)
):
    tournament = await tournaments_flows.get(session, tournament_id, [])
    logs = await s3_service.async_client.get_logs_by_tournament(tournament.id)
    return {"tournament": tournament.name, "logs": logs}


@router.post("/{tournament_id}")
async def process_tournament_logs(
    tournament_id: int, session=Depends(db.get_async_session)
):
    tournament = await tournaments_flows.get(session, tournament_id, [])
    await task_router.broker.publish(
        {"tournament_id": tournament.id}, "process_tournament_logs"
    )
    return {"message": f"Processing all logs for tournament '{tournament.name}'"}


@publisher
@task_router.subscriber(PROCESS_MATCH_LOGS_TOPIC)
async def process_match_logs(tournament_id: int, filename: str):
    async with db.async_session_maker() as session:
        tournament = await tournaments_flows.get(session, tournament_id, [])
        logger.info(
            f"Fetching logs from S3 for tournament {tournament.id} and file {filename}"
        )

        data = await s3_service.async_client.get_log_by_filename(
            tournament.id, filename
        )
        decoded_lines = [line.decode() for line in data.split(b"\n") if line]

        processor = flows.MatchLogProcessor(
            tournament, filename.split("/")[-1], decoded_lines
        )
        await processor.start(session)
        logger.info(f"Logs processed: tournament={tournament.name}, file={filename}")


@publisher
@task_router.subscriber("process_tournament_logs")
async def process_tournament_logs(tournament_id: int):
    async with db.async_session_maker() as session:
        tournament = await tournaments_flows.get(session, tournament_id, [])
        logs = await s3_service.async_client.get_logs_by_tournament(tournament.id)

        for log in logs:
            await task_router.broker.publish(
                {"tournament_id": tournament_id, "filename": log},
                PROCESS_MATCH_LOGS_TOPIC,
            )

        logger.info(
            f"All logs for tournament {tournament.name} are queued for processing."
        )
