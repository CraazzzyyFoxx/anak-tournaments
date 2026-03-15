// Admin CRUD Types

// ─── Tournament ──────────────────────────────────────────────────────────────

export interface TournamentCreateInput {
  name: string;
  number?: number;
  description?: string;
  is_league: boolean;
  start_date: string; // ISO date string
  end_date: string; // ISO date string
}

export interface TournamentUpdateInput {
  number?: number | null;
  name?: string;
  description?: string | null;
  is_league?: boolean;
  is_finished?: boolean;
  start_date?: string;
  end_date?: string;
}

export interface TournamentGroupCreateInput {
  name: string;
  description?: string | null;
  is_groups: boolean;
  challonge_id?: number | null;
  challonge_slug?: string | null;
}

export interface TournamentGroupUpdateInput {
  name?: string;
  description?: string | null;
  is_groups?: boolean;
  challonge_id?: number | null;
  challonge_slug?: string | null;
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
  primary?: boolean;
  secondary?: boolean;
  is_newcomer?: boolean;
  is_newcomer_role?: boolean;
  is_substitution?: boolean;
}

export interface PlayerUpdateInput {
  name?: string;
  role?: string;
  rank?: number;
  div?: number;
  primary?: boolean;
  secondary?: boolean;
  is_newcomer?: boolean;
  is_newcomer_role?: boolean;
  is_substitution?: boolean;
}

// ─── Encounter ───────────────────────────────────────────────────────────────

export interface EncounterCreateInput {
  tournament_id: number;
  tournament_group_id: number | null;
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
  home_team_id?: number;
  away_team_id?: number;
  home_score?: number;
  away_score?: number;
  status?: string;
  round?: number;
  name?: string;
}

export interface ChallongeTournamentLookup {
  id: number;
  name: string;
  url: string;
  description: string;
  state: string;
  participants_count: number;
  match_count?: number | null;
  group_stages_enabled: boolean;
  grand_finals_modifier?: string | null;
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
  id: number
  created_at: Date;
  updated_at?: Date | null;
  name: string
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
  description?: string;
  category?: string;
  icon?: string;
  hero_id?: number;
}

export interface AchievementUpdateInput {
  name?: string;
  description?: string;
  category?: string;
  icon?: string;
  hero_id?: number;
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
