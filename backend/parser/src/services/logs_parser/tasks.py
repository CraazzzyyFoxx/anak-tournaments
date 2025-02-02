import asyncio
from time import sleep

from fast_depends.dependencies import Depends
from loguru import logger

from src.core import db, faststream
from src.services.tournament import flows as tournament_flows
from src.services.tournament import service as tournament_service
from src.services.s3 import service as s3_service

from . import flows


@faststream.broker.subscriber("process_match_logs")
async def process_match_logs(tournament_id: int, filename: str, session: Depends(db.get_async_session)):
    tournament = await tournament_flows.get(session, tournament_id, [])
    logger.info(f"Trying get logs from s3 for tournament {tournament.id} and filename {filename}")
    data = asyncio.run(s3_service.async_client.get_log_by_filename(filename))
    logger.info(f"Got logs from s3 for tournament {tournament.id} and filename {filename}")
    data_str = [line.decode() for line in data.split(b"\n")]
    if data_str[-1] == "":
        data_str.pop()
    processor = flows.MatchLogProcessor(tournament, filename.split("/")[-1], data_str)
    await processor.start(session)

    logger.info(f"Logs for file {filename} in tournament {tournament.name} are being processed")



@faststream.broker.subscriber(name="process_tournament_logs")
async def process_tournament_logs(tournament_id: int, session: Depends(db.get_async_session)):
    tournament = await tournament_flows.get(session, tournament_id, [])
    logs = asyncio.run(s3_service.async_client.get_logs_by_tournament(tournament.id))

    workflow = process_match_logs.chunks(
        ((tournament.id, log) for log in logs), 10
    )
    result = workflow.apply_async()

    while not result.ready():
        sleep(1)

    return f"Logs for tournament {tournament.name} are being processed"


@faststream.broker.subscriber(name="process_all_logs")
async def process_all_logs():
    with db.session_maker() as session:
        tournaments = tournament_service.get_all_sync(session)

    workflow = chain(
        *[process_tournament_logs.si(tournament.id) for tournament in tournaments]
    )
    result = workflow()
    while not result.ready():
        sleep(1)
        pass

    return "All logs are being processed"
