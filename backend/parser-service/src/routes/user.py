from fastapi import APIRouter, Depends, UploadFile

from src.core import db, enums, auth

from src.services.user import flows as user_flows

router = APIRouter(
    prefix="/user",
    tags=[enums.RouteTag.USER],
    dependencies=[Depends(auth.require_role("admin"))],
)


@router.post(path="/create/csv")
async def bulk_create_users_from_csv(
    data: UploadFile,
    battle_tag_row: int,
    discord_row: int,
    twitch_row: int,
    smurf_row: int,
    start_row: int = 0,
    delimiter: str = ",",
    has_discord: bool = True,
    has_smurf: bool = True,
    has_twitch: bool = True,
    session=Depends(db.get_async_session),
):
    text = await data.read()
    await user_flows.bulk_create_users_from_csv(
        session,
        data.filename,
        text.decode("utf-8").split("\n"),
        start_row,
        battle_tag_row=battle_tag_row,
        discord_row=discord_row,
        twitch_row=twitch_row,
        smurf_row=smurf_row,
        delimiter=delimiter,
        has_discord=has_discord,
        has_smurf=has_smurf,
        has_twitch=has_twitch,
    )
    return {"success": True}


