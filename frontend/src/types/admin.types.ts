// Admin CRUD Types

// ─── Tournament ──────────────────────────────────────────────────────────────

import type {
  StageItemType,
  StageType,
  StageItemInputType,
  TournamentStatus
} from "@/types/tournament.types";

export interface TournamentCreateInput {
  workspace_id: number;
  name: string;
  number?: number;
  description?: string;
  is_league: boolean;
  status?: TournamentStatus;
  start_date: string;
  end_date: string;
  registration_opens_at?: string | null;
  registration_closes_at?: string | null;
  check_in_opens_at?: string | null;
  check_in_closes_at?: string | null;
  win_points?: number;
  draw_points?: number;
  loss_points?: number;
  division_grid_version_id?: number | null;
}

export interface TournamentUpdateInput {
  number?: number | null;
  name?: string;
  description?: string | null;
  challonge_slug?: string | null;
  is_league?: boolean;
  is_finished?: boolean;
  start_date?: string;
  end_date?: string;
  registration_opens_at?: string | null;
  registration_closes_at?: string | null;
  check_in_opens_at?: string | null;
  check_in_closes_at?: string | null;
  win_points?: number;
  draw_points?: number;
  loss_points?: number;
  division_grid_version_id?: number | null;
}

export interface TournamentStatusTransitionInput {
  status: TournamentStatus;
  force?: boolean;
}

// ─── Stage Admin ────────────────────────────────────────────────────────────

export interface StageCreateInput {
  name: string;
  description?: string | null;
  stage_type: StageType;
  order?: number;
  settings_json?: Record<string, unknown> | null;
}

export interface StageUpdateInput {
  name?: string;
  description?: string | null;
  stage_type?: StageType;
  order?: number;
  settings_json?: Record<string, unknown> | null;
}

export interface StageItemCreateInput {
  name: string;
  type: StageItemType;
  order?: number;
}

export interface StageItemInputCreateInput {
  slot: number;
  input_type?: StageItemInputType;
  team_id?: number | null;
  source_stage_item_id?: number | null;
  source_position?: number | null;
}

// ─── Captain Submission ─────────────────────────────────────────────────────

export interface ResultSubmissionInput {
  home_score: number;
  away_score: number;
}

export interface DisputeInput {
  reason?: string | null;
}

export interface VetoActionInput {
  map_id: number;
  action: "ban" | "pick";
}

// ─── Team ────────────────────────────────────────────────────────────────────

export interface TeamCreateInput {
  name: string;
  tournament_id: number;
  captain_id?: number;
  avg_sr?: number;
  total_sr?: number;
}

export interface TeamUpdateInput {
  name?: string;
  captain_id?: number;
  avg_sr?: number;
  total_sr?: number;
}

// ─── Player ──────────────────────────────────────────────────────────────────

export interface PlayerCreateInput {
  name: string;
  user_id: number;
  team_id: number;
  tournament_id: number;
  role: string;
  rank?: number;
  div?: number;
  sub_role?: string | null;
  is_newcomer?: boolean;
  is_newcomer_role?: boolean;
  is_substitution?: boolean;
}

export interface PlayerUpdateInput {
  name?: string;
  role?: string;
  rank?: number;
  div?: number;
  sub_role?: string | null;
  is_newcomer?: boolean;
  is_newcomer_role?: boolean;
  is_substitution?: boolean;
}

export interface PlayerSubRole {
  id: number;
  workspace_id: number;
  role: string;
  slug: string;
  label: string;
  description: string | null;
  sort_order: number;
  is_active: boolean;
}

export interface PlayerSubRoleCreateInput {
  workspace_id: number;
  role: string;
  label: string;
  slug?: string | null;
  description?: string | null;
  sort_order?: number;
  is_active?: boolean;
}

export interface PlayerSubRoleUpdateInput {
  role?: string;
  label?: string;
  slug?: string | null;
  description?: string | null;
  sort_order?: number;
  is_active?: boolean;
}

// ─── Encounter ───────────────────────────────────────────────────────────────

export interface EncounterCreateInput {
  tournament_id: number;
  tournament_group_id?: number | null;
  stage_id: number | null;
  stage_item_id: number | null;
  home_team_id: number;
  away_team_id: number;
  round: number;
  home_score?: number;
  away_score?: number;
  status?: string;
  name?: string;
}

export interface EncounterUpdateInput {
  tournament_group_id?: number | null;
  stage_id?: number | null;
  stage_item_id?: number | null;
  home_team_id?: number;
  away_team_id?: number;
  home_score?: number;
  away_score?: number;
  status?: string;
  round?: number;
  name?: string;
  closeness?: number | null;
}

export interface MatchUpdateInput {
  home_team_id?: number;
  away_team_id?: number;
  home_score?: number;
  away_score?: number;
  map_id?: number;
  code?: string | null;
  time?: number;
  log_name?: string;
}

// ─── Standing ────────────────────────────────────────────────────────────────

export interface StandingUpdateInput {
  position?: number;
  points?: number;
  win?: number;
  draw?: number;
  lose?: number;
}

// ─── User ────────────────────────────────────────────────────────────────────

export interface UserCreateInput {
  name: string;
}

export interface UserUpdateInput {
  name?: string;
}

// Discord Identity
export interface DiscordIdentityCreateInput {
  name: string;
}

export interface DiscordIdentityUpdateInput {
  name: string;
}

// BattleTag Identity
export interface BattleTagIdentityCreateInput {
  battle_tag: string;
}

export interface BattleTagIdentityUpdateInput {
  battle_tag: string;
}

// Twitch Identity
export interface TwitchIdentityCreateInput {
  name: string;
}

export interface TwitchIdentityUpdateInput {
  name: string;
}

// Generic (for backward compatibility)
export interface IdentityCreateInput {
  name?: string;
  battle_tag?: string;
}

export interface IdentityUpdateInput {
  name?: string;
  battle_tag?: string;
}

// ─── Hero ────────────────────────────────────────────────────────────────────

export interface HeroCreateInput {
  name: string;
  role: string;
  color?: string;
  image_path?: string;
}

export interface HeroUpdateInput {
  name?: string;
  role?: string;
  color?: string;
  image_path?: string;
}

// ─── Gamemode ────────────────────────────────────────────────────────────────

export interface Gamemode {
  id: number;
  created_at: Date;
  updated_at?: Date | null;
  name: string;
}

export interface GamemodeCreateInput {
  name: string;
}

export interface GamemodeUpdateInput {
  name?: string;
}

// ─── Map ─────────────────────────────────────────────────────────────────────

export interface MapCreateInput {
  name: string;
  gamemode_id: number;
}

export interface MapUpdateInput {
  name?: string;
  gamemode_id?: number;
}

// ─── Achievement ─────────────────────────────────────────────────────────────

export interface AchievementCreateInput {
  name: string;
  slug: string;
  description_ru: string;
  description_en: string;
  image_url?: string | null;
  hero_id?: number | null;
}

export interface AchievementUpdateInput {
  name?: string;
  slug?: string;
  description_ru?: string;
  description_en?: string;
  image_url?: string | null;
  hero_id?: number | null;
}

export interface AchievementRegistryEntry {
  slug: string;
  category: string;
  tournament_required: boolean;
}

export interface CalculationLogEntry {
  type: "start" | "progress" | "info" | "complete" | "error";
  slug?: string;
  index?: number;
  total?: number;
  status?: "running" | "done" | "error";
  message?: string;
  slugs?: string[];
  executed?: string[];
}

// ─── Achievement Rule Engine ──────────────────────────────────────────────────

export type AchievementCategory = "overall" | "hero" | "division" | "team" | "standing" | "match";
export type AchievementScope = "global" | "tournament" | "match";
export type AchievementGrain = "user" | "user_tournament" | "user_match";

export interface AchievementRule {
  id: number;
  workspace_id: number;
  slug: string;
  name: string;
  description_ru: string;
  description_en: string;
  image_url: string | null;
  hero_id: number | null;
  category: AchievementCategory;
  scope: AchievementScope;
  grain: AchievementGrain;
  condition_tree: Record<string, unknown>;
  depends_on: string[];
  enabled: boolean;
  rule_version: number;
  min_tournament_id: number | null;
  created_at: string;
  updated_at: string | null;
}

export interface AchievementRuleCreateInput {
  slug: string;
  name: string;
  description_ru: string;
  description_en: string;
  image_url?: string | null;
  hero_id?: number | null;
  category: AchievementCategory;
  scope: AchievementScope;
  grain: AchievementGrain;
  condition_tree: Record<string, unknown>;
  depends_on?: string[];
  enabled?: boolean;
  min_tournament_id?: number | null;
}

export interface AchievementRuleUpdateInput {
  slug?: string;
  name?: string;
  description_ru?: string;
  description_en?: string;
  image_url?: string | null;
  hero_id?: number | null;
  category?: AchievementCategory;
  scope?: AchievementScope;
  grain?: AchievementGrain;
  condition_tree?: Record<string, unknown>;
  depends_on?: string[];
  enabled?: boolean;
  rule_version?: number;
  min_tournament_id?: number | null;
}

export interface EvaluationRunRead {
  id: string;
  workspace_id: number;
  trigger: string;
  tournament_id: number | null;
  rules_evaluated: number;
  results_created: number;
  results_removed: number;
  started_at: string;
  finished_at: string | null;
  status: "running" | "done" | "failed" | "cancelled";
  error_message: string | null;
}

export interface SeedResultRead {
  seeded: number;
  removed: number;
}

export interface HardResetResultRead {
  seeded: number;
  removed: number;
  cleared_results: number;
  run: EvaluationRunRead;
}

export interface ConditionTreeValidateResponse {
  valid: boolean;
  errors: string[];
  inferred_grain: string | null;
}

export interface AchievementOverrideCreateInput {
  achievement_rule_id: number;
  user_id: number;
  tournament_id?: number | null;
  match_id?: number | null;
  action: "grant" | "revoke";
  reason: string;
}

export interface AchievementOverrideRead {
  id: number;
  achievement_rule_id: number;
  user_id: number;
  tournament_id: number | null;
  match_id: number | null;
  action: "grant" | "revoke";
  reason: string;
  granted_by: number;
  created_at: string;
}

export interface ConditionTypeInfo {
  name: string;
  grain: string;
  description: string;
  required_params: string[];
  optional_params: string[];
}

// ─── Challonge Sync ─────────────────────────────────────────────────────────

export interface ChallongeSyncLogEntry {
  id: number;
  created_at: string;
  direction: "import" | "export";
  entity_type: string;
  entity_id: number | null;
  challonge_id: number | null;
  status: "success" | "failed" | "conflict";
  error_message: string | null;
}

// ─── Discord Channel Sync ─────────────────────────────────────────────────────

export interface DiscordChannelRead {
  id: number;
  tournament_id: number;
  guild_id: string;
  channel_id: string;
  channel_name: string | null;
  is_active: boolean;
}

export interface DiscordChannelInput {
  guild_id: string;
  channel_id: string;
  channel_name?: string | null;
  is_active: boolean;
}

// ─── Log Processing ───────────────────────────────────────────────────────────

export type LogProcessingStatus = "pending" | "processing" | "done" | "failed";
export type LogProcessingSource = "upload" | "discord" | "manual";

export interface LogProcessingRecord {
  id: number;
  tournament_id: number;
  tournament_name: string | null;
  filename: string;
  status: LogProcessingStatus;
  source: LogProcessingSource;
  uploader_name: string | null;
  error_message: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
}

export interface LogHistoryResponse {
  items: LogProcessingRecord[];
  total: number;
}

export interface QueueDepth {
  name: string;
  messages_ready: number;
  messages_unacknowledged: number;
  consumers: number;
  status: "ok" | "not_found" | "error";
}

export interface LogStreamEvent {
  timestamp: string;
  queues: QueueDepth[];
  recent_logs: LogProcessingRecord[];
}

// ─── Bulk Operations ─────────────────────────────────────────────────────────

export interface CsvConfig {
  delimiter?: string;
  encoding?: string;
}

export interface BulkOperationResult {
  success: boolean;
  count: number;
  errors?: string[];
}

export interface CsvUserImportParams {
  battle_tag_row: number;
  discord_row: number | null;
  twitch_row: number | null;
  smurf_row: number | null;
  start_row?: number;
  delimiter?: string;
  has_discord?: boolean;
  has_smurf?: boolean;
  has_twitch?: boolean;
  sheet_url?: string;
}
