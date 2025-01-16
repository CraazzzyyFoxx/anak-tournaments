from fastapi import APIRouter, Depends, UploadFile

from src.core import db, enums

from src.services.tournament import flows as tournaments_flows
from src.services.auth import flows as auth_flows

from . import flows, tasks

router = APIRouter(prefix="/logs", tags=[enums.RouteTag.LOGS], dependencies=[Depends(auth_flows.current_user)])


@router.post(path="/process")
async def get_statistics(
    tournament_id: int,
    data: UploadFile,
    session=Depends(db.get_async_session),
):
    lines = data.file.readlines()
    new_lines = [line.decode() for line in lines]
    if data.filename is None:
        return {"message": "No file name provided"}
    tournament = await tournaments_flows.get(session, tournament_id, [])
    processor = flows.MatchLogProcessor(tournament, data.filename, new_lines)
    with db.session_maker() as session:
        processor.start(session, is_raise=True)
    return {"message": "Logs processed successfully"}


@router.post("/closeness")
async def upload_closeness(
        data: UploadFile,
        session=Depends(db.get_async_session)
):
    lines = data.file.readlines()
    new_lines = [line.decode() for line in lines]
    await flows.process_closeness(session, new_lines)
    return {"message": "Closeness processed successfully"}



@router.post("/match")
async def process_logs_for_match(tournament_id: int, filename: str):
    task = tasks.process_match_logs.delay(tournament_id, filename)
    return {"task_id": task.id}


@router.get("/match/{task_id}")
async def get_task_status(task_id: str):
    task = tasks.process_match_logs.AsyncResult(task_id)
    return {"status": task.state, "result": task.result}


@router.post("/tournament")
async def process_logs_for_tournament(tournament_id: int):
    task = tasks.process_tournament_logs.delay(tournament_id)
    return {"task_id": task.id}


@router.get("/tournament/{task_id}")
async def get_task_status(task_id: str):
    task = tasks.process_tournament_logs.AsyncResult(task_id)
    return {"status": task.state, "result": task.result}


@router.post("/all")
async def process_all_tournament_logs():
    task = tasks.process_all_logs.delay()
    return {"task_id": task.id}


@router.get("/all/{task_id}")
async def get_task_status(task_id: str):
    task = tasks.process_all_logs.AsyncResult(task_id)
    return {"status": task.state, "result": task.result}