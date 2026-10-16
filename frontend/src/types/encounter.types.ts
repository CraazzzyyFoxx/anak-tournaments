import { MapRead } from "@/types/map.types";
import { Team, TeamWithStats } from "@/types/team.types";
import {
  EncounterGame,
  EncounterResultSource,
  EncounterResultStatus,
  Stage,
  StageItem,
  Tournament,
} from "@/types/tournament.types";

/** A parsed log's own two-sided score (`matches.match`, V4 keeps it) — never an encounter's. */
export interface Score {
  home: number;
  away: number;
}

/**
 * One incoming advancement edge: place `source_position` of `encounter_id`
 * fills seat `slot` of this encounter. The bracket's real topology, so a
 * reader can label an unresolved slot ("1st of M3") without inferring the
 * bracket's shape. Absent on a bracket generated before advancement edges
 * were recorded.
 */
export interface EncounterSlotSource {
  encounter_id: number;
  /** Place in the source encounter's final standing; 1 is first. */
  source_position: number;
  /** Seat of this encounter the edge fills, `1..slot_count`. */
  slot: number;
}

/**
 * One live seat of an encounter (`encounter.team`), in slot order. `id` is the
 * participation id every write addresses — a claim, a report and an admin
 * result all name it, never a slot. `team_id` goes null when the source team
 * is deleted; `name` is the snapshot that outlives it.
 */
export interface EncounterTeam {
  id: number;
  slot: number;
  team_id: number | null;
  name: string;
  seed: number | null;
  /** The standing inside the encounter: wins under a series, points in a lobby. */
  score: number;
  placement: number | null;
  active: boolean;
  /** The source team, expanded only where the read asks for it. */
  team?: Team | null;
}

/** A game as the public encounter read serves it: the position also names its
 * map, so a map can be pictured before (or without) a parsed log. The pick-ban
 * room's `PickBanGame` carries no map object — only `map_id`. */
export interface EncounterGameWithMap extends EncounterGame {
  map: Match["map"];
}

export interface Encounter {
  id: number;
  created_at: Date;
  updated_at: Date | null;
  name: string;
  /** How many seats the card has: 2 is a duel, more is a lobby whose rows live in `FfaLobby`. */
  slot_count: number;
  /** How the card is scored: `points` is a lobby's card (a two-seat one included), `wins` a series. */
  scoring_preset: "wins" | "points";
  round: number;
  best_of: number;
  tournament_id: number;
  stage_id: number | null;
  stage_item_id: number | null;
  challonge_id: number | null;
  status: string;
  closeness: number | null;
  has_logs: boolean;
  result_status: EncounterResultStatus;
  /** Which writer decided the standing; null while no official result exists. */
  result_source: EncounterResultSource | null;
  /** Bumped by every result write; claims and reports name the version they were made against. */
  result_version: number;
  scheduled_at: Date | string | null;
  started_at: Date | string | null;
  ended_at: Date | string | null;
  current_map_index: number | null;
  // Every earlier decision lives in the result audit, not in a single slot
  // that only ever remembered the last writer.
  confirmed_at: Date | string | null;
  /** Empty on a bracket whose advancement edges were never recorded. */
  sources?: EncounterSlotSource[];

  matches: Match[];
  /**
   * One entry per position of the series, in play order — the encounter's own
   * result authority. A `Match` row is a parsed log, a separate contract: the
   * two are rendered as two facts, never merged (spec §11).
   */
  games: EncounterGameWithMap[];
  /** The live seats, in slot order; retired participations are history. */
  teams: EncounterTeam[];
  tournament: Tournament;
  stage?: Stage | null;
  stage_item?: StageItem | null;
}

export interface CaptainReportResult {
  encounter_team_id: number;
  score: number;
  placement: number | null;
  wins: number | null;
}

/** One participation's independent report of the finished encounter (`TeamReportRead`). */
export interface CaptainReport {
  id: number;
  encounter_id: number;
  /** The reporting participation. */
  encounter_team_id: number;
  reporter_user_id: number | null;
  /** Display name of the captain who filed it. */
  reporter_name?: string | null;
  /** Draws included; null only on a report carried over by the migration. */
  games_played: number | null;
  /** The `encounter.result_version` it was filed against. */
  basis_version: number;
  /** One line per live participation. */
  results: CaptainReportResult[];
  /** 1..10, or null when the tournament disables/does not require match quality. */
  closeness: number | null;
  comment: string | null;
  /** Organizer-defined text answers, keyed by `ReportCustomFieldDefinition.key`. */
  custom_fields: Record<string, string>;
  created_at: string | null;
  updated_at: string | null;
}

export interface ReportBuiltInFieldConfig {
  enabled: boolean;
  required: boolean;
}

export interface ReportCustomFieldDefinition {
  /** `^[a-z][a-z0-9_]{0,31}$`; the key under `CaptainReport.custom_fields`. */
  key: string;
  label: string;
  type: "text";
  required: boolean;
  placeholder: string | null;
}

/** Per-tournament configuration of the captain match-report form. */
export interface MatchReportForm {
  tournament_id: number;
  built_in_fields: {
    closeness: ReportBuiltInFieldConfig;
    map_codes: ReportBuiltInFieldConfig;
    comment: ReportBuiltInFieldConfig;
  };
  custom_fields: ReportCustomFieldDefinition[];
}

/**
 * One participation's replay code for one position (`ReplayCodeRead`, from
 * `game_team.replay_code`). The slot is the participation's own.
 */
export interface ReplayCode {
  position: number;
  encounter_team_id: number;
  code: string;
}

export interface CaptainReportsResponse {
  reports: CaptainReport[];
  /** Every participation's replay codes, in play order. */
  replay_codes: ReplayCode[];
  form: MatchReportForm;
}

/**
 * Mirrors the backend `DEFAULT_BUILT_IN_FIELDS`. Used while the reports query is
 * in flight so the dialog renders its usual shape instead of flashing empty and
 * then growing fields under the captain's cursor.
 */
export const DEFAULT_MATCH_REPORT_BUILT_INS: MatchReportForm["built_in_fields"] = Object.freeze({
  closeness: Object.freeze({ enabled: true, required: true }),
  map_codes: Object.freeze({ enabled: true, required: false }),
  comment: Object.freeze({ enabled: true, required: false })
});

export interface Match {
  id: number;
  created_at: Date;
  updated_at: Date | null;
  home_team_id: number | null;
  away_team_id: number | null;
  score: Score;
  time: number | null;
  encounter_id: number;
  map_id: number;
  /**
   * Bound game's 1-based series position. It, not `map_id`, identifies a
   * played map: a series may play the same map twice. Null means the response
   * has no position information (see `seriesMatchesByPosition`).
   */
  map_index: number | null;
  log_name: string | null;

  map: MapRead | null;
  home_team: Team | null;
  away_team: Team | null;
  encounter: Encounter | null;
}

export interface MatchWithStats extends Match {
  rounds: number;
  home_team: TeamWithStats | null;
  away_team: TeamWithStats | null;
}

type EncounterScope = "all" | "my_team";

export interface EncounterFilters {
  tournament_id?: number | null;
  stage_id?: number | null;
  stage_item_id?: number | null;
  best_of?: number | null;
  status?: string | null;
  has_logs?: boolean | null;
  closeness_min?: number | null;
  closeness_max?: number | null;
  scope?: EncounterScope;
  sort?: string | null;
}

export interface EncounterSavedView {
  id: number;
  workspace_id: number;
  name: string;
  filters: EncounterFilters & { query?: string };
  sort_order: number;
}

interface EncounterKpis {
  total_encounters: number;
  recent_count: number;
  with_logs_count: number;
  with_logs_pct: number;
  avg_closeness: number | null;
  live_now_count: number;
  upcoming_count: number;
}

interface EncounterHistogramBucket {
  label: string;
  start: number;
  end: number;
  count: number;
}

/** One scoreline of a two-seat encounter, slot 1 against slot 2. */
export interface EncounterScoreHeatmapCell {
  slot_one: number;
  slot_two: number;
  count: number;
}

export interface EncounterStageSplit {
  name: string;
  count: number;
  pct: number;
}

interface EncounterMapMetric {
  name: string;
  count: number;
}

interface EncounterPulse {
  avg_series_seconds: number | null;
  completed_series_count: number;
  sweep_rate: number;
  sweep_count: number;
  went_distance_count: number;
  reverse_sweep_rate: number;
  most_decisive_map: string | null;
}

/** How often each seat of a duel wins — the seeding bias slot 1 carries. */
interface EncounterSlotBalance {
  slot_one_wins: number;
  slot_two_wins: number;
  slot_one_win_pct: number;
  slot_two_win_pct: number;
}

interface EncounterFeatured {
  closest: Encounter[];
  upcoming: Encounter[];
  live: Encounter[];
}

export interface EncounterOverview {
  kpis: EncounterKpis;
  preset_counts: Record<string, number>;
  closeness_histogram: EncounterHistogramBucket[];
  score_heatmap: EncounterScoreHeatmapCell[];
  stage_split: EncounterStageSplit[];
  featured: EncounterFeatured;
  hot_maps: EncounterMapMetric[];
  pulse: EncounterPulse;
  slot_balance: EncounterSlotBalance;
}
