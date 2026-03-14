export type BalancerRoleCode = "tank" | "dps" | "support";
export type BalancerRosterKey = "Tank" | "Damage" | "Support";
export type BalancerRoleSubtype = "hitscan" | "projectile" | "main_heal" | "light_heal";
export type DuplicateResolution = "replace" | "skip";
export type DuplicateStrategy = "manual" | "replace_all" | "skip_all";

export interface BalancerTournamentSheet {
  id: number;
  tournament_id: number;
  source_url: string;
  sheet_id: string;
  gid: string | null;
  title: string | null;
  header_row_json: string[] | null;
  column_mapping_json: Record<string, unknown> | null;
  role_mapping_json: Record<string, BalancerRoleCode | null> | null;
  is_active: boolean;
  last_synced_at: string | null;
  last_sync_status: string | null;
  last_error: string | null;
}

export interface BalancerPlayerRecord {
  id: number;
  tournament_id: number;
  application_id: number;
  battle_tag: string;
  battle_tag_normalized: string;
  user_id: number | null;
  role_entries_json: BalancerPlayerRoleEntry[];
  is_flex: boolean;
  is_in_pool: boolean;
  admin_notes: string | null;
}

export interface BalancerPlayerRoleEntry {
  role: BalancerRoleCode;
  subtype: BalancerRoleSubtype | null;
  priority: number;
  division_number: number | null;
  rank_value: number | null;
  is_active: boolean;
}

export interface BalancerApplication {
  id: number;
  tournament_id: number;
  tournament_sheet_id: number;
  battle_tag: string;
  battle_tag_normalized: string;
  smurf_tags_json: string[];
  twitch_nick: string | null;
  discord_nick: string | null;
  stream_pov: boolean;
  last_tournament_text: string | null;
  primary_role: string | null;
  additional_roles_json: string[];
  notes: string | null;
  submitted_at: string | null;
  synced_at: string;
  is_active: boolean;
  player: BalancerPlayerRecord | null;
}

export interface SheetSyncResponse {
  created: number;
  updated: number;
  deactivated: number;
  total: number;
  sheet: BalancerTournamentSheet;
}

export interface InternalBalancePlayer {
  uuid: string;
  name: string;
  rating: number;
  discomfort?: number;
  isCaptain?: boolean;
  preferences: string[];
  allRatings?: Record<string, number>;
}

export interface InternalBalanceTeam {
  id: number;
  name: string;
  avgMMR: number;
  variance?: number | null;
  totalDiscomfort?: number | null;
  maxDiscomfort?: number | null;
  roster: Record<BalancerRosterKey, InternalBalancePlayer[]>;
}

export interface InternalBalancePayload {
  teams: InternalBalanceTeam[];
  statistics?: {
    averageMMR?: number;
    mmrStdDev?: number;
    totalTeams?: number;
    playersPerTeam?: number;
    offRoleCount?: number;
    subRoleCollisionCount?: number;
    unbalancedCount?: number;
  };
  benchedPlayers?: InternalBalancePlayer[];
}

export interface SavedBalancerTeam {
  id: number;
  balance_id: number;
  exported_team_id: number | null;
  name: string;
  balancer_name: string;
  captain_battle_tag: string | null;
  avg_sr: number;
  total_sr: number;
  roster_json: Record<string, unknown>;
  sort_order: number;
}

export interface SavedBalance {
  id: number;
  tournament_id: number;
  config_json: Record<string, unknown> | null;
  result_json: InternalBalancePayload;
  saved_by: number | null;
  saved_at: string;
  exported_at: string | null;
  export_status: string | null;
  export_error: string | null;
  teams: SavedBalancerTeam[];
}

export interface BalanceExportResponse {
  success: boolean;
  removed_teams: number;
  imported_teams: number;
  balance_id: number;
}

export interface TournamentSheetUpsertInput {
  source_url: string;
  title?: string | null;
  column_mapping_json?: Record<string, unknown> | null;
  role_mapping_json?: Record<string, BalancerRoleCode | null> | null;
}

export interface BalancerPlayerCreateInput {
  application_ids: number[];
}

export interface BalancerPlayerImportDuplicate {
  battle_tag: string;
  battle_tag_normalized: string;
  application_id: number;
  existing_player_id: number;
  imported_role_entries_json: BalancerPlayerRoleEntry[];
  existing_role_entries_json: BalancerPlayerRoleEntry[];
  imported_is_in_pool: boolean;
  existing_is_in_pool: boolean;
  imported_admin_notes: string | null;
  existing_admin_notes: string | null;
}

export interface BalancerPlayerImportSkipped {
  battle_tag: string;
  battle_tag_normalized: string;
  reason: "missing_active_application" | "duplicate_in_file" | "no_ranked_roles";
}

export interface BalancerPlayerImportPreviewResponse {
  total_players: number;
  creatable_players: number;
  duplicate_players: number;
  skipped_players: number;
  duplicates: BalancerPlayerImportDuplicate[];
  skipped: BalancerPlayerImportSkipped[];
}

export interface BalancerPlayerImportResult {
  success: boolean;
  created: number;
  replaced: number;
  skipped_duplicates: number;
  skipped_missing_application: number;
  skipped_duplicate_in_file: number;
  skipped_no_ranked_roles: number;
  total_players: number;
}

export interface BalancerPlayerExportResponse {
  format: string;
  players: Record<string, unknown>;
}

export interface BalancerPlayerRoleSyncResponse {
  updated: number;
  skipped: number;
}

export interface ApplicationUserExportResponse {
  processed: number;
  skipped: number;
  total: number;
}

export interface BalancerPlayerUpdateInput {
  role_entries_json?: BalancerPlayerRoleEntry[] | null;
  is_in_pool?: boolean | null;
  is_flex?: boolean | null;
  admin_notes?: string | null;
}

export interface BalanceSaveInput {
  config_json?: Record<string, unknown> | null;
  result_json: InternalBalancePayload;
}
