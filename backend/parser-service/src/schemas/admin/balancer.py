from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field

from src.schemas import BaseRead

BalancerRole = Literal["tank", "dps", "support"]
BalancerRoleSubtype = Literal["hitscan", "projectile", "main_heal", "light_heal"]
DuplicateResolution = Literal["replace", "skip"]
DuplicateStrategy = Literal["manual", "replace_all", "skip_all"]

__all__ = (
    "BalanceExportResponse",
    "BalanceRead",
    "BalanceSaveRequest",
    "BalancerApplicationRead",
    "BalancerPlayerCreateRequest",
    "BalancerPlayerRead",
    "BalancerPlayerImportDuplicate",
    "BalancerPlayerImportPreviewResponse",
    "BalancerPlayerImportResult",
    "BalancerPlayerImportSkipped",
    "BalancerPlayerRoleEntry",
    "BalancerPlayerUpdate",
    "BalancerPlayerExportResponse",
    "BalancerTeamRead",
    "BalancerTournamentSheetRead",
    "BalancerTournamentSheetUpsert",
    "SheetSyncResponse",
)


class BalancerTournamentSheetUpsert(BaseModel):
    source_url: str
    title: str | None = None
    column_mapping_json: dict[str, Any] | None = None
    role_mapping_json: dict[str, str | None] | None = None


class BalancerPlayerRoleEntry(BaseModel):
    role: BalancerRole
    subtype: BalancerRoleSubtype | None = None
    priority: int
    division_number: int | None = None
    rank_value: int | None = None


class BalancerPlayerRead(BaseRead):
    tournament_id: int
    application_id: int
    battle_tag: str
    battle_tag_normalized: str
    user_id: int | None
    role_entries_json: list[BalancerPlayerRoleEntry] = Field(default_factory=list)
    is_flex: bool
    is_in_pool: bool
    admin_notes: str | None


class BalancerApplicationRead(BaseRead):
    tournament_id: int
    tournament_sheet_id: int
    battle_tag: str
    battle_tag_normalized: str
    smurf_tags_json: list[str] = Field(default_factory=list)
    twitch_nick: str | None
    discord_nick: str | None
    stream_pov: bool
    last_tournament_text: str | None
    primary_role: str | None
    additional_roles_json: list[str] = Field(default_factory=list)
    notes: str | None
    submitted_at: datetime | None
    synced_at: datetime
    is_active: bool
    player: BalancerPlayerRead | None = None


class BalancerTournamentSheetRead(BaseRead):
    tournament_id: int
    source_url: str
    sheet_id: str
    gid: str | None
    title: str | None
    header_row_json: list[str] | None = None
    column_mapping_json: dict[str, Any] | None = None
    role_mapping_json: dict[str, str | None] | None = None
    is_active: bool
    last_synced_at: datetime | None
    last_sync_status: str | None
    last_error: str | None


class SheetSyncResponse(BaseModel):
    created: int
    updated: int
    deactivated: int
    total: int
    sheet: BalancerTournamentSheetRead


class BalancerPlayerCreateRequest(BaseModel):
    application_ids: list[int]


class BalancerPlayerUpdate(BaseModel):
    role_entries_json: list[BalancerPlayerRoleEntry] | None = None
    is_flex: bool | None = None
    is_in_pool: bool | None = None
    admin_notes: str | None = None


class BalancerPlayerImportDuplicate(BaseModel):
    battle_tag: str
    battle_tag_normalized: str
    application_id: int
    existing_player_id: int
    imported_role_entries_json: list[BalancerPlayerRoleEntry] = Field(default_factory=list)
    existing_role_entries_json: list[BalancerPlayerRoleEntry] = Field(default_factory=list)
    imported_is_in_pool: bool = True
    existing_is_in_pool: bool = True
    imported_admin_notes: str | None = None
    existing_admin_notes: str | None = None


class BalancerPlayerImportSkipped(BaseModel):
    battle_tag: str
    battle_tag_normalized: str
    reason: Literal["missing_active_application", "duplicate_in_file"]


class BalancerPlayerImportPreviewResponse(BaseModel):
    total_players: int
    creatable_players: int
    duplicate_players: int
    skipped_players: int
    duplicates: list[BalancerPlayerImportDuplicate] = Field(default_factory=list)
    skipped: list[BalancerPlayerImportSkipped] = Field(default_factory=list)


class BalancerPlayerImportResult(BaseModel):
    success: bool
    created: int
    replaced: int
    skipped_duplicates: int
    skipped_missing_application: int
    skipped_duplicate_in_file: int
    total_players: int


class BalancerPlayerExportResponse(BaseModel):
    format: str
    players: dict[str, Any]


class BalancerTeamRead(BaseRead):
    balance_id: int
    exported_team_id: int | None = None
    name: str
    balancer_name: str
    captain_battle_tag: str | None
    avg_sr: float
    total_sr: int
    roster_json: dict[str, Any]
    sort_order: int


class BalanceSaveRequest(BaseModel):
    config_json: dict[str, Any] | None = None
    result_json: dict[str, Any]


class BalanceRead(BaseRead):
    tournament_id: int
    config_json: dict[str, Any] | None = None
    result_json: dict[str, Any]
    saved_by: int | None
    saved_at: datetime
    exported_at: datetime | None
    export_status: str | None
    export_error: str | None
    teams: list[BalancerTeamRead] = Field(default_factory=list)


class BalanceExportResponse(BaseModel):
    success: bool
    removed_teams: int
    imported_teams: int
    balance_id: int
