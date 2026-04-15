from __future__ import annotations

import json
from typing import Literal

import sqlalchemy as sa
import src.services.team as team_flows
from fastapi import APIRouter, Depends, File, Form, UploadFile
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm.attributes import NO_VALUE
from src import models
from src.core import auth, db
from src.schemas.admin import balancer as admin_schemas
from src.schemas.team import BalancerTeam, InternalBalancerTeamsPayload
from src.services.admin import balancer as legacy_balancer_service
from src.services.admin import balancer_registration as registration_service

router = APIRouter(
    prefix="/balancer",
    tags=["admin", "balancer"],
    dependencies=[Depends(auth.require_any_role("admin", "tournament_organizer"))],
)


def _loaded_relationship_or_none(instance: object, attribute: str):
    loaded_value = sa.inspect(instance).attrs[attribute].loaded_value
    if loaded_value is NO_VALUE:
        return None
    return loaded_value


def _serialize_role_entries(
    player: models.BalancerPlayer,
) -> list[admin_schemas.BalancerPlayerRoleEntry]:
    loaded_role_entries = _loaded_relationship_or_none(player, "role_entries")
    if loaded_role_entries is not None:
        normalized_entries = [
            {
                "role": entry.role,
                "subtype": entry.subtype,
                "priority": entry.priority,
                "division_number": entry.division_number,
                "rank_value": entry.rank_value,
                "is_active": entry.is_active,
            }
            for entry in sorted(loaded_role_entries, key=lambda entry: entry.priority)
        ]
    else:
        normalized_entries = legacy_balancer_service.normalize_role_entries(player.role_entries_json)

    return [
        admin_schemas.BalancerPlayerRoleEntry.model_validate(entry)
        for entry in normalized_entries
    ]


def _serialize_player(
    player: models.BalancerPlayer,
) -> admin_schemas.BalancerPlayerRead:
    return admin_schemas.BalancerPlayerRead(
        id=player.id,
        tournament_id=player.tournament_id,
        application_id=player.application_id,
        battle_tag=player.battle_tag,
        battle_tag_normalized=player.battle_tag_normalized,
        user_id=player.user_id,
        role_entries_json=_serialize_role_entries(player),
        is_flex=player.is_flex,
        is_in_pool=player.is_in_pool,
        admin_notes=player.admin_notes,
    )


def _serialize_application(
    application: models.BalancerApplication,
) -> admin_schemas.BalancerApplicationRead:
    player = _loaded_relationship_or_none(application, "player")
    return admin_schemas.BalancerApplicationRead(
        id=application.id,
        tournament_id=application.tournament_id,
        tournament_sheet_id=application.tournament_sheet_id,
        battle_tag=application.battle_tag,
        battle_tag_normalized=application.battle_tag_normalized,
        smurf_tags_json=application.smurf_tags_json or [],
        twitch_nick=application.twitch_nick,
        discord_nick=application.discord_nick,
        stream_pov=application.stream_pov,
        last_tournament_text=application.last_tournament_text,
        primary_role=application.primary_role,
        additional_roles_json=application.additional_roles_json or [],
        notes=application.notes,
        submitted_at=application.submitted_at,
        synced_at=application.synced_at,
        is_active=application.is_active,
        player=_serialize_player(player) if player is not None else None,
    )


def _serialize_feed(
    feed: models.BalancerRegistrationGoogleSheetFeed,
) -> admin_schemas.BalancerGoogleSheetFeedRead:
    return admin_schemas.BalancerGoogleSheetFeedRead(
        id=feed.id,
        tournament_id=feed.tournament_id,
        source_url=feed.source_url,
        sheet_id=feed.sheet_id,
        gid=feed.gid,
        title=feed.title,
        header_row_json=feed.header_row_json,
        mapping_config_json=feed.mapping_config_json,
        value_mapping_json=feed.value_mapping_json,
        auto_sync_enabled=feed.auto_sync_enabled,
        auto_sync_interval_seconds=feed.auto_sync_interval_seconds,
        last_synced_at=feed.last_synced_at,
        last_sync_status=feed.last_sync_status,
        last_error=feed.last_error,
    )


def _serialize_balance(
    balance: models.BalancerBalance,
) -> admin_schemas.BalanceRead:
    return admin_schemas.BalanceRead(
        id=balance.id,
        tournament_id=balance.tournament_id,
        config_json=balance.config_json,
        result_json=balance.result_json,
        saved_by=balance.saved_by,
        saved_at=balance.saved_at,
        exported_at=balance.exported_at,
        export_status=balance.export_status,
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
    return _serialize_feed(feed)


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
    return _serialize_feed(feed)


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
        feed=_serialize_feed(feed),
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
    return [_serialize_application(application) for application in applications]


@router.post("/tournaments/{tournament_id}/players", response_model=list[admin_schemas.BalancerPlayerRead])
async def create_players_from_applications(
    tournament_id: int,
    data: admin_schemas.BalancerPlayerCreateRequest,
    session: AsyncSession = Depends(db.get_async_session),
    user: models.AuthUser = Depends(auth.require_permission("player", "create")),
):
    players = await legacy_balancer_service.create_players_from_applications(session, tournament_id, data)
    return [_serialize_player(player) for player in players]


@router.get("/tournaments/{tournament_id}/players", response_model=list[admin_schemas.BalancerPlayerRead])
async def list_players(
    tournament_id: int,
    in_pool_only: bool = False,
    session: AsyncSession = Depends(db.get_async_session),
    user: models.AuthUser = Depends(auth.require_permission("player", "read")),
):
    players = await legacy_balancer_service.list_players(session, tournament_id, in_pool_only=in_pool_only)
    return [_serialize_player(player) for player in players]


@router.patch("/players/{player_id}", response_model=admin_schemas.BalancerPlayerRead)
async def update_player(
    player_id: int,
    data: admin_schemas.BalancerPlayerUpdate,
    session: AsyncSession = Depends(db.get_async_session),
    user: models.AuthUser = Depends(auth.require_permission("player", "update")),
):
    player = await legacy_balancer_service.update_player(session, player_id, data)
    return _serialize_player(player)


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
    return _serialize_balance(balance)


@router.put("/tournaments/{tournament_id}/balance", response_model=admin_schemas.BalanceRead)
async def save_balance(
    tournament_id: int,
    data: admin_schemas.BalanceSaveRequest,
    session: AsyncSession = Depends(db.get_async_session),
    user: models.AuthUser = Depends(auth.require_permission("team", "import")),
):
    balance = await legacy_balancer_service.save_balance(session, tournament_id, data, user)
    return _serialize_balance(balance)


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
