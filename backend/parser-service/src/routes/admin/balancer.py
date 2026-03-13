from __future__ import annotations

import json

from fastapi import APIRouter, Depends, File, Form, Query, UploadFile
from sqlalchemy.ext.asyncio import AsyncSession

from src import models
from src.core import auth, db
from src.schemas.admin import balancer as admin_schemas
from src.services.admin import balancer as balancer_service

router = APIRouter(
    prefix="/balancer",
    tags=["admin", "balancer"],
    dependencies=[Depends(auth.require_any_role("admin", "tournament_organizer"))],
)


@router.get("/tournaments/{tournament_id}/sheet", response_model=admin_schemas.BalancerTournamentSheetRead | None)
async def get_tournament_sheet(
    tournament_id: int,
    session: AsyncSession = Depends(db.get_async_session),
    user: models.AuthUser = Depends(auth.require_permission("team", "read")),
):
    sheet = await balancer_service.get_tournament_sheet(session, tournament_id)
    if sheet is None:
        return None
    return admin_schemas.BalancerTournamentSheetRead.model_validate(sheet, from_attributes=True)


@router.put("/tournaments/{tournament_id}/sheet", response_model=admin_schemas.BalancerTournamentSheetRead)
async def upsert_tournament_sheet(
    tournament_id: int,
    data: admin_schemas.BalancerTournamentSheetUpsert,
    session: AsyncSession = Depends(db.get_async_session),
    user: models.AuthUser = Depends(auth.require_permission("team", "import")),
):
    sheet = await balancer_service.upsert_tournament_sheet(session, tournament_id, data)
    return admin_schemas.BalancerTournamentSheetRead.model_validate(sheet, from_attributes=True)


@router.post("/tournaments/{tournament_id}/sheet/sync", response_model=admin_schemas.SheetSyncResponse)
async def sync_tournament_sheet(
    tournament_id: int,
    session: AsyncSession = Depends(db.get_async_session),
    user: models.AuthUser = Depends(auth.require_permission("team", "import")),
):
    sheet, created, updated, deactivated, total = await balancer_service.sync_tournament_sheet(session, tournament_id)
    return admin_schemas.SheetSyncResponse(
        created=created,
        updated=updated,
        deactivated=deactivated,
        total=total,
        sheet=admin_schemas.BalancerTournamentSheetRead.model_validate(sheet, from_attributes=True),
    )


@router.get("/tournaments/{tournament_id}/applications", response_model=list[admin_schemas.BalancerApplicationRead])
async def list_applications(
    tournament_id: int,
    include_inactive: bool = Query(default=False),
    session: AsyncSession = Depends(db.get_async_session),
    user: models.AuthUser = Depends(auth.require_permission("team", "read")),
):
    applications = await balancer_service.list_applications(session, tournament_id, include_inactive=include_inactive)
    return [
        admin_schemas.BalancerApplicationRead.model_validate(application, from_attributes=True)
        for application in applications
    ]


@router.post("/tournaments/{tournament_id}/players", response_model=list[admin_schemas.BalancerPlayerRead])
async def create_players_from_applications(
    tournament_id: int,
    data: admin_schemas.BalancerPlayerCreateRequest,
    session: AsyncSession = Depends(db.get_async_session),
    user: models.AuthUser = Depends(auth.require_permission("player", "create")),
):
    players = await balancer_service.create_players_from_applications(session, tournament_id, data)
    return [admin_schemas.BalancerPlayerRead.model_validate(player, from_attributes=True) for player in players]


@router.get("/tournaments/{tournament_id}/players", response_model=list[admin_schemas.BalancerPlayerRead])
async def list_players(
    tournament_id: int,
    in_pool_only: bool = Query(default=False),
    session: AsyncSession = Depends(db.get_async_session),
    user: models.AuthUser = Depends(auth.require_permission("player", "read")),
):
    players = await balancer_service.list_players(session, tournament_id, in_pool_only=in_pool_only)
    return [admin_schemas.BalancerPlayerRead.model_validate(player, from_attributes=True) for player in players]


@router.patch("/players/{player_id}", response_model=admin_schemas.BalancerPlayerRead)
async def update_player(
    player_id: int,
    data: admin_schemas.BalancerPlayerUpdate,
    session: AsyncSession = Depends(db.get_async_session),
    user: models.AuthUser = Depends(auth.require_permission("player", "update")),
):
    player = await balancer_service.update_player(session, player_id, data)
    return admin_schemas.BalancerPlayerRead.model_validate(player, from_attributes=True)


@router.delete("/players/{player_id}", status_code=204)
async def delete_player(
    player_id: int,
    session: AsyncSession = Depends(db.get_async_session),
    user: models.AuthUser = Depends(auth.require_permission("player", "delete")),
):
    await balancer_service.delete_player(session, player_id)


@router.post(
    "/tournaments/{tournament_id}/players/import/preview",
    response_model=admin_schemas.BalancerPlayerImportPreviewResponse,
)
async def preview_player_import(
    tournament_id: int,
    data: UploadFile = File(...),
    match_application_roles: bool = Form(default=False),
    session: AsyncSession = Depends(db.get_async_session),
    user: models.AuthUser = Depends(auth.require_permission("player", "update")),
):
    payload = json.loads((await data.read()).decode("utf-8"))
    return await balancer_service.preview_player_import(
        session,
        tournament_id,
        payload,
        match_application_roles=match_application_roles,
    )


@router.post("/tournaments/{tournament_id}/players/import", response_model=admin_schemas.BalancerPlayerImportResult)
async def import_players(
    tournament_id: int,
    data: UploadFile = File(...),
    duplicate_strategy: admin_schemas.DuplicateStrategy = Form(...),
    match_application_roles: bool = Form(default=False),
    resolutions_json: str | None = Form(default=None),
    session: AsyncSession = Depends(db.get_async_session),
    user: models.AuthUser = Depends(auth.require_permission("player", "update")),
):
    payload = json.loads((await data.read()).decode("utf-8"))
    resolutions = json.loads(resolutions_json) if resolutions_json else None
    return await balancer_service.import_players(
        session,
        tournament_id,
        payload,
        duplicate_strategy=duplicate_strategy,
        resolutions=resolutions,
        match_application_roles=match_application_roles,
    )


@router.get("/tournaments/{tournament_id}/players/export", response_model=admin_schemas.BalancerPlayerExportResponse)
async def export_players(
    tournament_id: int,
    session: AsyncSession = Depends(db.get_async_session),
    user: models.AuthUser = Depends(auth.require_permission("player", "read")),
):
    return await balancer_service.export_players(session, tournament_id)


@router.post(
    "/tournaments/{tournament_id}/players/application-roles",
    response_model=admin_schemas.BalancerPlayerRoleSyncResponse,
)
async def sync_player_roles_from_applications(
    tournament_id: int,
    session: AsyncSession = Depends(db.get_async_session),
    user: models.AuthUser = Depends(auth.require_permission("player", "update")),
):
    return await balancer_service.sync_player_roles_from_applications(session, tournament_id)


@router.get("/tournaments/{tournament_id}/balance", response_model=admin_schemas.BalanceRead | None)
async def get_balance(
    tournament_id: int,
    session: AsyncSession = Depends(db.get_async_session),
    user: models.AuthUser = Depends(auth.require_permission("team", "read")),
):
    balance = await balancer_service.get_balance(session, tournament_id)
    if balance is None:
        return None
    return admin_schemas.BalanceRead.model_validate(balance, from_attributes=True)


@router.put("/tournaments/{tournament_id}/balance", response_model=admin_schemas.BalanceRead)
async def save_balance(
    tournament_id: int,
    data: admin_schemas.BalanceSaveRequest,
    session: AsyncSession = Depends(db.get_async_session),
    user: models.AuthUser = Depends(auth.require_permission("team", "import")),
):
    balance = await balancer_service.save_balance(session, tournament_id, data, user)
    return admin_schemas.BalanceRead.model_validate(balance, from_attributes=True)


@router.post("/balances/{balance_id}/export", response_model=admin_schemas.BalanceExportResponse)
async def export_balance(
    balance_id: int,
    session: AsyncSession = Depends(db.get_async_session),
    user: models.AuthUser = Depends(auth.require_permission("team", "import")),
):
    balance, removed_teams, imported_teams = await balancer_service.export_balance(session, balance_id)
    return admin_schemas.BalanceExportResponse(
        success=True,
        removed_teams=removed_teams,
        imported_teams=imported_teams,
        balance_id=balance.id,
    )
