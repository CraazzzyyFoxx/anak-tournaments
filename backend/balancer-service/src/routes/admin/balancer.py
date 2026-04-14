from __future__ import annotations

import json
from typing import Literal

from fastapi import APIRouter, Depends, File, Form, UploadFile
from sqlalchemy.ext.asyncio import AsyncSession

from src import models
from src.core import auth, db
from src.schemas.admin import balancer as admin_schemas
from src.schemas.team import BalancerTeam, InternalBalancerTeamsPayload
from src.services.admin import balancer as legacy_balancer_service
from src.services.admin import balancer_registration as registration_service
import src.services.team as team_flows

router = APIRouter(
    prefix="/balancer",
    tags=["admin", "balancer"],
    dependencies=[Depends(auth.require_any_role("admin", "tournament_organizer"))],
)


@router.get(
    "/tournaments/{tournament_id}/sheet",
    response_model=admin_schemas.BalancerGoogleSheetFeedRead | None,
)
async def get_tournament_sheet(
    tournament_id: int,
    session: AsyncSession = Depends(db.get_async_session),
    user: models.AuthUser = Depends(auth.require_permission("team", "read")),
):
    feed = await registration_service.get_google_sheet_feed(session, tournament_id)
    if feed is None:
        return None
    return admin_schemas.BalancerGoogleSheetFeedRead.model_validate(feed, from_attributes=True)


@router.put(
    "/tournaments/{tournament_id}/sheet",
    response_model=admin_schemas.BalancerGoogleSheetFeedRead,
)
async def upsert_tournament_sheet(
    tournament_id: int,
    data: admin_schemas.BalancerGoogleSheetFeedUpsert,
    session: AsyncSession = Depends(db.get_async_session),
    user: models.AuthUser = Depends(auth.require_permission("team", "import")),
):
    feed = await registration_service.upsert_google_sheet_feed(
        session,
        tournament_id,
        source_url=data.source_url,
        title=data.title,
        auto_sync_enabled=data.auto_sync_enabled,
        auto_sync_interval_seconds=data.auto_sync_interval_seconds,
        mapping_config_json=data.mapping_config_json,
        value_mapping_json=data.value_mapping_json,
    )
    return admin_schemas.BalancerGoogleSheetFeedRead.model_validate(feed, from_attributes=True)


@router.post(
    "/tournaments/{tournament_id}/sheet/sync",
    response_model=admin_schemas.BalancerGoogleSheetFeedSyncResponse,
)
async def sync_tournament_sheet(
    tournament_id: int,
    session: AsyncSession = Depends(db.get_async_session),
    user: models.AuthUser = Depends(auth.require_permission("team", "import")),
):
    feed, created, updated, withdrawn, total = await registration_service.sync_google_sheet_feed(session, tournament_id)
    return admin_schemas.BalancerGoogleSheetFeedSyncResponse(
        created=created,
        updated=updated,
        withdrawn=withdrawn,
        total=total,
        feed=admin_schemas.BalancerGoogleSheetFeedRead.model_validate(feed, from_attributes=True),
    )


@router.post(
    "/tournaments/{tournament_id}/sheet/suggest-mapping",
    response_model=admin_schemas.BalancerGoogleSheetMappingSuggestResponse,
)
async def suggest_sheet_mapping(
    tournament_id: int,
    data: admin_schemas.BalancerGoogleSheetMappingSuggestRequest,
    session: AsyncSession = Depends(db.get_async_session),
    user: models.AuthUser = Depends(auth.require_permission("team", "read")),
):
    _, headers, mapping = await registration_service.suggest_google_sheet_mapping(
        session,
        tournament_id,
        source_url=data.source_url,
    )
    return admin_schemas.BalancerGoogleSheetMappingSuggestResponse(
        headers=headers,
        mapping_config_json=mapping,
    )


@router.post(
    "/tournaments/{tournament_id}/sheet/preview",
    response_model=admin_schemas.BalancerGoogleSheetMappingPreviewResponse,
)
async def preview_sheet_mapping(
    tournament_id: int,
    data: admin_schemas.BalancerGoogleSheetMappingPreviewRequest,
    session: AsyncSession = Depends(db.get_async_session),
    user: models.AuthUser = Depends(auth.require_permission("team", "read")),
):
    preview = await registration_service.preview_google_sheet_mapping(
        session,
        tournament_id,
        source_url=data.source_url,
        mapping_config_json=data.mapping_config_json,
        value_mapping_json=data.value_mapping_json,
    )
    return admin_schemas.BalancerGoogleSheetMappingPreviewResponse(**preview)


@router.get("/tournaments/{tournament_id}/applications", response_model=list[admin_schemas.BalancerApplicationRead])
async def list_applications(
    tournament_id: int,
    include_inactive: bool = False,
    session: AsyncSession = Depends(db.get_async_session),
    user: models.AuthUser = Depends(auth.require_permission("team", "read")),
):
    applications = await legacy_balancer_service.list_applications(
        session,
        tournament_id,
        include_inactive=include_inactive,
    )
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
    players = await legacy_balancer_service.create_players_from_applications(session, tournament_id, data)
    return [admin_schemas.BalancerPlayerRead.model_validate(player, from_attributes=True) for player in players]


@router.get("/tournaments/{tournament_id}/players", response_model=list[admin_schemas.BalancerPlayerRead])
async def list_players(
    tournament_id: int,
    in_pool_only: bool = False,
    session: AsyncSession = Depends(db.get_async_session),
    user: models.AuthUser = Depends(auth.require_permission("player", "read")),
):
    players = await legacy_balancer_service.list_players(session, tournament_id, in_pool_only=in_pool_only)
    return [admin_schemas.BalancerPlayerRead.model_validate(player, from_attributes=True) for player in players]


@router.patch("/players/{player_id}", response_model=admin_schemas.BalancerPlayerRead)
async def update_player(
    player_id: int,
    data: admin_schemas.BalancerPlayerUpdate,
    session: AsyncSession = Depends(db.get_async_session),
    user: models.AuthUser = Depends(auth.require_permission("player", "update")),
):
    player = await legacy_balancer_service.update_player(session, player_id, data)
    return admin_schemas.BalancerPlayerRead.model_validate(player, from_attributes=True)


@router.delete("/players/{player_id}", status_code=204)
async def delete_player(
    player_id: int,
    session: AsyncSession = Depends(db.get_async_session),
    user: models.AuthUser = Depends(auth.require_permission("player", "delete")),
):
    await legacy_balancer_service.delete_player(session, player_id)


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
    return await legacy_balancer_service.preview_player_import(
        session,
        tournament_id,
        payload,
        match_application_roles=match_application_roles,
    )


@router.post(
    "/tournaments/{tournament_id}/players/import",
    response_model=admin_schemas.BalancerPlayerImportResult,
)
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
    return await legacy_balancer_service.import_players(
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
    payload = await registration_service.export_active_registrations(session, tournament_id)
    return admin_schemas.BalancerPlayerExportResponse(**payload)


@router.post(
    "/tournaments/{tournament_id}/applications/export-users",
    response_model=admin_schemas.ApplicationUserExportResponse,
)
async def export_applications_to_users(
    tournament_id: int,
    session: AsyncSession = Depends(db.get_async_session),
    user: models.AuthUser = Depends(auth.require_permission("player", "import")),
):
    return await legacy_balancer_service.export_applications_to_users(session, tournament_id)


@router.post(
    "/tournaments/{tournament_id}/players/application-roles",
    response_model=admin_schemas.BalancerPlayerRoleSyncResponse,
)
async def sync_player_roles_from_applications(
    tournament_id: int,
    session: AsyncSession = Depends(db.get_async_session),
    user: models.AuthUser = Depends(auth.require_permission("player", "update")),
):
    return await legacy_balancer_service.sync_player_roles_from_applications(session, tournament_id)


@router.get("/tournaments/{tournament_id}/balance", response_model=admin_schemas.BalanceRead | None)
async def get_balance(
    tournament_id: int,
    session: AsyncSession = Depends(db.get_async_session),
    user: models.AuthUser = Depends(auth.require_permission("team", "read")),
):
    balance = await legacy_balancer_service.get_balance(session, tournament_id)
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
    balance = await legacy_balancer_service.save_balance(session, tournament_id, data, user)
    return admin_schemas.BalanceRead.model_validate(balance, from_attributes=True)


@router.post("/balances/{balance_id}/export", response_model=admin_schemas.BalanceExportResponse)
async def export_balance(
    balance_id: int,
    session: AsyncSession = Depends(db.get_async_session),
    user: models.AuthUser = Depends(auth.require_permission("team", "import")),
):
    balance, removed_teams, imported_teams = await legacy_balancer_service.export_balance(session, balance_id)
    return admin_schemas.BalanceExportResponse(
        success=True,
        removed_teams=removed_teams,
        imported_teams=imported_teams,
        balance_id=balance.id,
    )


@router.post("/tournaments/{tournament_id}/teams/import")
async def import_teams_from_json(
    tournament_id: int,
    data: UploadFile = File(...),
    payload_format: Literal["auto", "atravkovs", "internal"] = Form(default="auto"),
    session: AsyncSession = Depends(db.get_async_session),
    user: models.AuthUser = Depends(auth.require_permission("team", "import")),
):
    payload = json.loads((await data.read()).decode("utf-8"))

    use_atravkovs = payload_format == "atravkovs" or (
        payload_format == "auto"
        and isinstance(payload, dict)
        and isinstance(payload.get("data"), dict)
        and "teams" in payload["data"]
    )

    if use_atravkovs:
        teams = [BalancerTeam.model_validate(team) for team in payload["data"]["teams"]]
    else:
        internal_payload = InternalBalancerTeamsPayload.model_validate(payload)
        teams = [team.to_balancer_team() for team in internal_payload.teams]

    await team_flows.bulk_create_from_balancer(session, tournament_id, teams)
    return {"imported_teams": len(teams)}
