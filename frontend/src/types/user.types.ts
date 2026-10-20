import type { RoleRef } from "@/lib/roster/role-ref";
import type { Schema } from "@/types/api";
import type { CatalogEntityRead } from "@/types/catalog.types";
import type { RawSourceStatus } from "@/types/encounter.types";
import type { PaginatedResponse } from "@/types/pagination.types";
import { UserTournamentStat } from "@/types/statistics.types";
import { DivisionGridVersion } from "@/types/workspace.types";

/** One character's share (0..1) of the observed playtime of the returned set — a fraction, not a duration. */
export interface CharacterPlaytime {
  entity: CatalogEntityRead;
  playtime: number;
}

/** A stat's best single-match value, with where it happened. */
export type CharacterStatBest = Schema<"app.CharacterStatBest">;

/** One stat of one character for a player: career total, best match and per-10 averages (player and everyone). */
export type CharacterStat = Schema<"app.CharacterStat">;

export interface CharacterWithUserStats {
  character: CatalogEntityRead;
  stats: CharacterStat[];
}

/** A character's stats without their per-stat best-match records: what an overview card reads (smaller RSC props). */
export interface CharacterSummary {
  character: CatalogEntityRead;
  stats: Omit<CharacterStat, "best" | "best_all">[];
}

export type SocialProvider =
  "battlenet" | "discord" | "twitch" | "boosty" | "vk" | "youtube" | "riot";

export interface SocialAccount {
  id: number;
  user_id: number;
  provider: SocialProvider;
  username: string;
  url: string | null;
  is_verified: boolean;
  is_primary: boolean;
  /** Display visibility (populated by the admin profile dialog read). */
  visible_global?: boolean;
  visible_workspace_ids?: number[];
}

export interface User {
  id: number;
  created_at: Date;
  updated_at: Date | null;
  name: string;
  avatar_url: string | null;
  social_accounts: SocialAccount[];
  /** Stream-privacy veto for this player, and a veto is all it is: `false`
   *  keeps the live stream off every tournament page, overriding both the
   *  per-tournament Stream POV opt-in and any visible Twitch account. Optional
   *  because responses cached before the field existed simply omit it —
   *  `undefined` means the backend default, which is "allowed". */
  stream_visible?: boolean;
}

export interface UserRole {
  role: RoleRef | null;
  tournaments: number;
  maps_won: number;
  maps: number;
  division: number;
  division_grid_version: DivisionGridVersion | null;
}

export interface UserTournamentWithStats {
  id: number;
  name: string;
  /** The tournament's owner workspace and game: its role and division are drawn in that scope. */
  workspace_id: number;
  discipline: string;
  division: number;
  /** Grid the `division` was resolved against — render its icon on this grid,
   * not the workspace default. */
  division_grid_version: DivisionGridVersion | null;
  role: RoleRef | null;
  group_placement: number;
  playoff_placement: number;
  maps_won: number;
  maps: number;
  playtime: number;

  stats: Record<string, UserTournamentStat>;
}

/**
 * Narrow projections for user-scoped API responses.
 *
 * After P3-A these shapes are defined by `app-service` and don't reuse the
 * canonical Tournament/Encounter/Match/Player types from tournament-service.
 * They contain only the fields the user pages render.
 */

export interface UserTournamentSummary {
  id: number;
  name: string;
  is_league: boolean;
  is_finished?: boolean;
  status?: string | null;
  division_grid_version: DivisionGridVersion | null;
}

interface UserTournamentPlayer {
  id: number;
  name: string;
  role: RoleRef | null;
  rank: number;
  division: number;
  user_id: number;
  is_substitution: boolean;
  is_newcomer: boolean;
  is_newcomer_role: boolean;
  related_player_id: number | null;
  relative_player?: number | null;
  /** Average MVP placement across the player's matches (1 = MVP/best). */
  avg_mvp?: number | null;
  /** Player's top signature characters (same shape as per-match `characters`). */
  characters?: CatalogEntityRead[];
}

interface UserEncounterTournament {
  id: number;
  name: string;
  is_league: boolean;
  is_finished?: boolean;
  status?: string | null;
}

interface UserEncounterStageSummary {
  id: number;
  name: string;
}

interface UserEncounterStageItemSummary {
  id: number;
  name: string;
}

interface UserEncounterTeamPlayerRef {
  id: number;
  user_id: number;
  role: RoleRef | null;
  name: string;
}

/** One live seat of an encounter: `id` is the participation, `team_id` the source team (null once deleted). */
interface UserEncounterTeamSummary {
  id: number;
  slot: number;
  team_id: number | null;
  name: string;
  score: number;
  placement: number | null;
  players: UserEncounterTeamPlayerRef[];
}

/** One native observation of a stat; `segment` 0 with null member/entity is a member's whole-match total when `workspace_member_id` is set. */
export type UserNativeFact = Schema<"app.NativeFact">;

/** The viewer's own seat and whole-match totals in one match; absent when the viewer's seat was not observed. */
export interface UserMatchViewer {
  encounter_team_id: number;
  workspace_member_id: number;
  /** Segment-0, no-entity facts of the viewer by stat code; an absent key is missing, never zero. */
  facts: Record<string, number>;
  /** The characters the viewer played in this match (module eligibility rule applied by the server). */
  characters: CatalogEntityRead[];
}

/**
 * A match inside a user-scoped encounter: the native header (participants with official result and observed
 * team facts) plus the viewer's facts and EVERY observed member's whole-match totals. No derived value
 * (placement, badge) rides on the wire: a discipline's renderer derives them from `viewer.facts` against
 * `member_totals`.
 */
export interface MatchWithUserStats
  extends Omit<Schema<"app.MatchReadWithUserStats">, "map" | "raw_status" | "viewer" | "member_totals"> {
  raw_status: RawSourceStatus | null;
  /** Always expanded, with its mode as `map.parent`. */
  map: CatalogEntityRead;
  viewer: UserMatchViewer | null;
  member_totals: UserNativeFact[];
}

export interface EncounterWithUserStats {
  id: number;
  name: string;
  slot_count: number;
  round: number;
  best_of: number;
  tournament_id: number;
  /** The encounter's game: a cross-game list (spec §6.6) marks each row with it. */
  discipline: string;
  status: string;
  closeness: number | null;
  has_logs: boolean;
  result_status: string;
  /** The source team the viewer played for. */
  user_team_id: number | null;
  tournament: UserEncounterTournament | null;
  stage: UserEncounterStageSummary | null;
  stage_item: UserEncounterStageItemSummary | null;
  /** The live seats in slot order; a retired participation is history. */
  teams: UserEncounterTeamSummary[];
  matches: MatchWithUserStats[];
}

export interface UserTournament {
  id: number;
  name: string;
  workspace_id: number;
  discipline: string;
  is_league: boolean;
  team_id: number;
  team: string;
  players: UserTournamentPlayer[];
  closeness: number;
  placement: number;
  count_teams: number;
  won: number;
  lost: number;
  draw: number;
  maps_won: number;
  maps_lost: number;
  division: number;
  division_grid_version: DivisionGridVersion | null;
  role: RoleRef | null;

  /** Only populated after a lazy fetch of `/tournaments/{id}/encounters` for
   *  the tournament currently open in the dossier — the list endpoint omits
   *  it so a career-spanning history doesn't ship every event's full
   *  encounter/match log up front. */
  encounters?: EncounterWithUserStats[];
}

/** A player's career in one read, shaped for the draft room's player card. */
export interface UserDraftCard {
  tournaments: number;
  tournaments_won: number;
  maps: number;
  maps_won: number;
  maps_lost: number;
  /** `null` when the data cannot tell who was MVP of a map. */
  mvp_maps: number | null;
  best_placement: number | null;
  avg_placement: number | null;
  roles: { role: RoleRef | null; maps: number; maps_won: number }[];
  /** Every character played, most maps first. */
  characters?: { character: CatalogEntityRead; maps: number; maps_won: number }[];
  /** Newest first, at most five. */
  recent_tournaments: {
    id: number;
    name: string;
    date: string | null;
    role: RoleRef | null;
    rank: number | null;
    placement: number | null;
    teams_count: number | null;
  }[];
}

export interface UserProfile {
  tournaments_count: number;
  tournaments_won: number;
  maps_total: number;
  maps_won: number;
  avg_closeness: number | null;
  avg_placement: number | null;
  avg_playoff_placement: number | null;
  avg_group_placement: number | null;
  most_played_character: CatalogEntityRead | null;
  characters_count: number;

  roles: UserRole[];
  character_statistics: CharacterPlaytime[];
  tournaments: UserTournamentSummary[];
}

export interface UserMapRead {
  map: CatalogEntityRead;
  count: number;
  win: number;
  loss: number;
  draw: number;
  win_rate: number;
  characters?: CharacterPlaytime[];
  character_stats?: UserMapCharacterStats[] | null;
}

export interface UserMapCharacterStats {
  character: CatalogEntityRead;
  games: number;
  win: number;
  loss: number;
  draw: number;
  win_rate: number;
  playtime_seconds: number;
  playtime_share_on_map: number;
}

interface UserMapHighlight {
  map: CatalogEntityRead;
  count: number;
  win: number;
  loss: number;
  draw: number;
  win_rate: number;
}

interface UserMapsOverall {
  total_maps: number;
  total_games: number;
  win: number;
  loss: number;
  draw: number;
  win_rate: number;
}

export interface UserMapsSummary {
  overall: UserMapsOverall;
  most_played: UserMapHighlight | null;
  best: UserMapHighlight | null;
  worst: UserMapHighlight | null;
}

export interface UserBestTeammate {
  user: User;
  tournaments: number;
  maps: number;
  winrate: number;
  stats: Record<string, number | null>;
}

interface UserOpponentStat {
  name: string;
  wins: number;
  losses: number;
  draws: number;
}

interface UserStageRecord {
  w: number;
  l: number;
}

export interface UserMatchesSummary {
  opponents: UserOpponentStat[];
  stages: Record<"group" | "playoffs" | "finals", UserStageRecord>;
}

/** One player's standing in a tournament lobby for a single stat. */
interface LobbyLeaderboardEntry {
  rank: number;
  /** The player's user id (matches the profile route id). */
  player_id: number;
  name: string;
  value: number;
}

/** Full per-stat ranking of every player in a tournament lobby. */
export interface LobbyLeaderboard {
  stat: string;
  total_players: number;
  entries: LobbyLeaderboardEntry[];
}

export interface MinimizedUser {
  id: number;
  name: string;
}

export interface UserOverviewRoleDivision {
  role: RoleRef | null;
  division: number;
  /**
   * The grid version `division` belongs to — the workspace's target grid in
   * workspace scope, the tournament's own effective grid in all-workspaces
   * scope (where ranks are never normalized across grids). Resolve it against
   * the response's `division_grids`.
   */
  division_grid_version_id: number | null;
}

export interface UserOverviewCharacter {
  character: CatalogEntityRead;
  playtime_seconds: number;
}

interface UserOverviewAverages {
  avg_closeness: number | null;
  avg_placement: number | null;
  avg_playoff_placement: number | null;
  avg_group_placement: number | null;
}

/** The career aggregates every index surface (table row, catalog card) needs. */
interface UserOverviewBase {
  id: number;
  name: string;
  avatar_url: string | null;
  roles: UserOverviewRoleDivision[];
  top_characters: UserOverviewCharacter[];
  tournaments_count: number;
  achievements_count: number;
  maps_won: number;
  maps_lost: number;
  /** Distinct encounters with a result — the sample size behind the map winrate. */
  encounters_played: number;
  best_placement: number | null;
  /** ISO date of the last tournament the player appeared in, scope-filtered. */
  last_active_at: string | null;
}

export interface UserOverviewRow extends UserOverviewBase {
  averages: UserOverviewAverages;
}

export interface UserOverviewDivisionCount {
  division: number;
  count: number;
}

export interface UserOverviewStats {
  total_players: number;
  with_logs_count: number;
  with_logs_pct: number;
  avg_tournaments_per_player: number;
  median_tournaments_per_player: number;
  active_last_30d: number;
  active_last_30d_pct: number;
  /** Distinct players per role code of the game's rated dimension (codes nobody played are absent). */
  role_counts: Record<string, number>;
  /** "Plays anything": multi-role or explicit flex — wider than the chip below. */
  flex_count: number;
  /** Users the open-slot (`role=flex`) chip itself matches, under the other filters. */
  flex_declared_count: number;
  /** Per division, ignoring the `divisions` filter so the facet stays usable. */
  division_counts: UserOverviewDivisionCount[];
}

export interface UserCatalogEntry extends UserOverviewBase {
  avg_placement: number | null;
}

interface UserCatalogLetter {
  letter: string;
  count: number;
  users: UserCatalogEntry[];
}

export interface UserCatalogResponse {
  letters: UserCatalogLetter[];
  total: number;
  available_letters: string[];
  /** Every grid version referenced by a role in this response, once. */
  division_grids: DivisionGridVersion[];
}

/** The users index page, plus the grid versions its role divisions point at. */
export interface UserOverviewResponse extends PaginatedResponse<UserOverviewRow> {
  division_grids: DivisionGridVersion[];
}

export type UserCompareBaselineMode = "target_user" | "global" | "cohort";

interface UserCompareUser {
  id: number;
  name: string;
}

interface UserCompareBaselineInfo {
  mode: UserCompareBaselineMode;
  sample_size: number;
  target_user: UserCompareUser | null;
  role: RoleRef | null;
  div_min: number | null;
  div_max: number | null;
}

type UserCompareBetterWorse = "better" | "worse" | "equal";

interface UserCompareMetric {
  key: string;
  label: string;
  subject_value: number | null;
  baseline_value: number | null;
  delta: number | null;
  delta_percent: number | null;
  better_worse: UserCompareBetterWorse | null;
  higher_is_better: boolean;
  subject_rank: number | null;
  subject_percentile: number | null;
}

export interface UserCompareResponse {
  subject: UserCompareUser;
  baseline: UserCompareBaselineInfo;
  metrics: UserCompareMetric[];
}

interface UserCharacterCompareMetric {
  stat: string;
  left_value: number;
  right_value: number;
  delta: number;
  delta_percent: number | null;
  better_worse: UserCompareBetterWorse | null;
  higher_is_better: boolean;
}

export interface UserCharacterCompareResponse {
  subject: UserCompareUser;
  target: UserCompareUser | null;
  baseline: UserCompareBaselineInfo;
  subject_character: CatalogEntityRead | null;
  target_character: CatalogEntityRead | null;
  map: CatalogEntityRead | null;
  left_playtime_seconds: number;
  right_playtime_seconds: number;
  metrics: UserCharacterCompareMetric[];
}
