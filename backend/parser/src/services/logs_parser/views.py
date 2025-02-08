from fastapi import APIRouter, Depends, HTTPException, UploadFile
from faststream.redis.fastapi import RedisRouter
from loguru import logger

from src.core import config, db, enums
from src.services.auth import flows as auth_flows
from src.services.s3 import service as s3_service
from src.services.tournament import flows as tournaments_flows
from src.services.tournament import service as tournaments_service

from . import flows

PROCESS_MATCH_LOGS_TOPIC = "process_match_log"

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


@router.post("/")
async def process_all_logs(session=Depends(db.get_async_session)):
    tournaments = await tournaments_service.get_all(session)
    for tournament in tournaments:
        if tournament.id > 20:
            await task_router.broker.publish(
                {"tournament_id": tournament.id}, "process_tournament_logs"
            )
    return {"message": "Processing all logs for all tournaments"}


@publisher
@task_router.subscriber(PROCESS_MATCH_LOGS_TOPIC)
async def process_match_log(tournament_id: int, filename: str):
    async with db.async_session_maker() as session:
        await flows.process_match_log(session, tournament_id, filename, is_raise=True)


@publisher
@task_router.subscriber("process_tournament_logs")
async def process_tournament_log(tournament_id: int):
    async with db.async_session_maker() as session:
        tournament = await tournaments_flows.get(session, tournament_id, [])

    for log in await s3_service.async_client.get_logs_by_tournament(tournament.id):
        await flows.process_match_log(session, tournament.id, log, is_raise=False)

    logger.info(f"All logs for tournament {tournament.name} are queued for processing.")
