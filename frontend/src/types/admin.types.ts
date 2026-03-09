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
  name?: string;
  description?: string;
  is_finished?: boolean;
  start_date?: string;
  end_date?: string;
}

export interface TournamentGroupCreateInput {
  name: string;
  is_playoffs: boolean;
  is_groups: boolean;
}

export interface TournamentGroupUpdateInput {
  name?: string;
  is_playoffs?: boolean;
  is_groups?: boolean;
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
  user_id: number;
  team_id: number;
  role: string;
  rank?: number;
  division?: number;
  is_primary?: boolean;
  is_secondary?: boolean;
  is_newcomer?: boolean;
  is_newcomer_role?: boolean;
  is_substitution?: boolean;
}

export interface PlayerUpdateInput {
  role?: string;
  rank?: number;
  division?: number;
  is_primary?: boolean;
  is_secondary?: boolean;
  is_newcomer?: boolean;
  is_newcomer_role?: boolean;
  is_substitution?: boolean;
}

// ─── Encounter ───────────────────────────────────────────────────────────────

export interface EncounterCreateInput {
  tournament_id: number;
  tournament_group_id: number;
  home_team_id: number;
  away_team_id: number;
  round: number;
  home_score?: number;
  away_score?: number;
  status?: string;
  name?: string;
}

export interface EncounterUpdateInput {
  home_score?: number;
  away_score?: number;
  status?: string;
  round?: number;
  name?: string;
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
}

export interface HeroUpdateInput {
  name?: string;
  role?: string;
  color?: string;
}

// ─── Gamemode ────────────────────────────────────────────────────────────────

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
