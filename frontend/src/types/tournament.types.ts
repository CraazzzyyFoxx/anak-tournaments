import { User } from "@/types/user.types";
import { Team } from "@/types/team.types";
import { Encounter } from "@/types/encounter.types";
import { DivisionGridVersion } from "@/types/workspace.types";
import type { RosterShape, RosterSlotMap } from "@/lib/roster-shape";

// ─── Enums ──────────────────────────────────────────────────────────────────

export type TournamentStatus =
  | "registration"
  | "draft"
  | "check_in"
  | "live"
  | "playoffs"
  | "completed"
  | "archived";

export type StageType =
  | "round_robin"
  | "single_elimination"
  | "double_elimination"
  | "swiss";

export type StageItemType =
  | "group"
  | "bracket_upper"
  | "bracket_lower"
  | "single_bracket";

export type StageItemInputType = "final" | "tentative" | "empty";

export type EncounterResultStatus =
  | "none"
  | "pending_confirmation"
  | "confirmed"
  | "disputed";

export type MapPoolEntryStatus = "available" | "picked" | "banned" | "played";
export type MapPickSide = "home" | "away" | "decider" | "admin";
export type MapVetoAction = "pick" | "ban";

// ─── Legacy (kept for backward compat) ──────────────────────────────────────

export interface TournamentGroup {
  id: number;
  created_at: Date;
  updated_at: Date | null;
  name: string;
  description: string | null;
  is_groups: boolean;
  challonge_id: number | null;
  challonge_slug: string | null;
  stage_id: number | null;
}

// ─── Stage Model ────────────────────────────────────────────────────────────

export interface StageItemInput {
  id: number;
  stage_item_id: number;
  slot: number;
  input_type: StageItemInputType;
  team_id: number | null;
  source_stage_item_id: number | null;
  source_position: number | null;
}

export interface StageItem {
  id: number;
  stage_id: number;
  name: string;
  type: StageItemType;
  order: number;
  inputs: StageItemInput[];
}

export interface StageSummary {
  id: number;
  tournament_id: number;
  name: string;
  description: string | null;
  stage_type: StageType;
  max_rounds: number;
  advance_count: number | null;
  split_lower_bracket: boolean;
  order: number;
  is_active: boolean;
  is_completed: boolean;
  settings_json: Record<string, unknown> | null;
  challonge_id: number | null;
  challonge_slug: string | null;
}

export interface Stage extends StageSummary {
  items: StageItem[];
}

// ─── Tournament ─────────────────────────────────────────────────────────────

export interface TournamentPhaseSchedule {
  status: TournamentStatus;
  starts_at: string;
  ends_at: string | null;
}

export interface Tournament {
  id: number;
  created_at: Date;
  updated_at: Date | null;
  workspace_id: number;
  name: string;
  start_date: Date;
  end_date: Date;
  description: string | null;
  challonge_id: number | null;
  challonge_slug: string | null;
  is_league: boolean;
  is_finished: boolean;
  is_hidden: boolean;
  team_formation: string;
  status: TournamentStatus;
  auto_transitions_enabled: boolean;
  allow_late_registration: boolean;
  phase_schedule: TournamentPhaseSchedule[];
  win_points: number;
  draw_points: number;
  loss_points: number;

  stages: StageSummary[];
  groups?: TournamentGroup[];
  participants_count: number | null;
  registrations_count: number | null;
  teams_count: number | null;
  division_grid_version_id: number | null;
  division_grid_version: DivisionGridVersion | null;
  /** Tournament-level override of the roster shape; `null` = inherit. */
  roster_slots_json: RosterSlotMap | null;
  /** Resolved shape. `null` when the read did not opt into the entity. */
  roster_shape: RosterShape | null;
  /**
   * `true` while a draft session is in flight, i.e. while the write-path guard
   * would reject a roster-shape change. `null` on reads that did not opt in.
   */
  roster_locked_by_draft: boolean | null;
}

// ─── Map Pool ───────────────────────────────────────────────────────────────

export interface EncounterMapPoolEntry {
  id: number;
  map_id: number;
  /**
   * Slot this candidate belongs to, or null in `"pool"` (flat) mode.
   *
   * Every entry of a `"slots"`-mode pool carries one and every entry of a flat
   * pool carries null, so this — not `EncounterMapPoolState.current_slot` — is
   * what tells the two modes apart: a completed slot veto also reports
   * `current_slot: null`.
   *
   * The value is the config slot's `position`, never an index into this pool.
   */
  slot: number | null;
  order: number;
  /** Global veto-action order (bans AND picks); null while still available. */
  action_index: number | null;
  picked_by: MapPickSide | null;
  /** Denormalized team that picked this map (null unless PICKED). */
  team_id: number | null;
  status: MapPoolEntryStatus;
}

export type MapVetoSessionStatus = "active" | "completed" | "cancelled";
export type VetoSeedSource = "bracket_slot" | "standings" | "fallback_home" | "admin";

export interface EncounterVetoSession {
  id: number;
  status: MapVetoSessionStatus;
  first_side: "home" | "away";
  seed_source: VetoSeedSource;
  home_seed: number | null;
  away_seed: number | null;
  turn_timer_seconds: number | null;
  started_at: string | null;
  current_step_started_at: string | null;
  /**
   * The reserve map each in-play slot named, snapshotted when the session was
   * created and never re-read from the config, so a running veto keeps the
   * reserves it started with.
   *
   * Keyed by the slot's `position` **as a string** — the backing column is JSON,
   * so the server stringifies the key to survive the round trip — while slot
   * numbers everywhere else in the room are numbers. `slotReserveMaps` is where
   * that boundary is crossed.
   *
   * Null in `"pool"` mode. A slot that named no reserve is absent rather than
   * mapped to null, so a lookup missing is the normal case, not an anomaly.
   */
  slot_reserves: Record<string, number> | null;
}

/**
 * Reason the room has no session yet (state responses with `session: null`).
 *
 * `slot_count_mismatch` (the bracket wants more maps than the config has slots)
 * and `slot_underfilled` (a slot in play has fewer than two candidates) both
 * describe a config that exists but disagrees with the bracket, so they must
 * not share the `not_configured` copy.
 */
export type VetoUnavailableReason =
  | "not_configured"
  | "teams_unknown"
  | "slot_count_mismatch"
  | "slot_underfilled"
  | "not_ready"
  /** Hero bans only: this round's map has not been picked yet, and heroes are
   * banned for a known map. Resolves on its own as the map phase progresses. */
  | "waiting_map";

export interface EncounterMapPoolState {
  session: EncounterVetoSession | null;
  /**
   * Set only when `session` is null. Its presence — not `session === null`
   * alone — is what identifies the unavailable state.
   */
  reason?: VetoUnavailableReason;
  /** Step tokens already resolved to sides (e.g. "ban_home", "decider"). */
  sequence: string[];
  pool: EncounterMapPoolEntry[];
  viewer_side: "home" | "away" | null;
  viewer_can_act: boolean;
  allowed_actions: MapVetoAction[];
  current_step_index: number | null;
  current_step: string | null;
  expected_action: MapVetoAction | "decider" | null;
  turn_side: "home" | "away" | null;
  /**
   * Slot the veto is resolving, and null in three distinct situations: a
   * `"pool"`-mode veto (no slots at all), a completed slot veto (no pending
   * step), and the unavailable state (`session: null`).
   *
   * So it is neither a completion signal — `is_complete` is the authority —
   * nor a mode signal; read the mode off `pool[].slot`.
   */
  current_slot: number | null;
  is_complete: boolean;
}

/** Side-agnostic step tokens stored on veto configs. */
export type VetoSequenceToken =
  | "ban_first"
  | "ban_second"
  | "pick_first"
  | "pick_second"
  | "decider";

/**
 * How a veto config decides its step order.
 *
 * - `"bracket"` — follow the bracket. The veto session regenerates the steps
 *   from `Encounter.best_of` at match time, so this config carries no opinion
 *   about series length. What is stored alongside it is a fallback preview.
 * - `"custom"` — the organizer authored the steps; they are used verbatim and
 *   this level is opted out of the bracket.
 * - `"bo1"`…`"bo7"` — legacy template labels written before the bracket owned
 *   series length. Behaviourally identical to `"bracket"`: the server treats
 *   everything except `"custom"` as bracket-driven.
 */
export type VetoPreset = "bracket" | "custom" | "bo1" | "bo2" | "bo3" | "bo5" | "bo7";

/** Which pool shape a veto config uses. Mirrors the backend `MapVetoMode`. */
export type MapVetoMode = "pool" | "slots";

/**
 * Which side opens each slot's bans, in `"slots"` mode only. Mirrors the
 * backend `FirstBanRotation`.
 */
export type FirstBanRotation = "fixed" | "alternate";

/** One slot as the config serializer returns it. */
export interface MapVetoConfigSlot {
  /**
   * 1-based play order. Carried even though the upsert derives it: the editor
   * sorts the stored slots by this rather than trusting the array's order, and
   * it is the same ordinal `EncounterMapPoolEntry.slot` carries, so the config
   * and the room name a slot identically.
   */
  position: number;
  /** Candidate map ids, in the organizer's authored order. */
  candidates: number[];
  reserve_map_id: number | null;
}

export interface MapVetoConfig {
  id: number;
  tournament_id: number;
  stage_id: number | null;
  round: number | null;
  /** Which pool shape the fields below carry. */
  mode: MapVetoMode;
  preset: VetoPreset | null;
  first_pick_rule: "higher_seed";
  /** Slot mode only; nothing reads it in `"pool"` mode. */
  first_ban_rotation: FirstBanRotation;
  turn_timer_seconds: number | null;
  /** Empty in `"slots"` mode. */
  sequence: VetoSequenceToken[];
  /** Empty in `"slots"` mode. */
  map_ids: number[];
  /** Empty in `"pool"` mode: the serializer always sends both pool shapes. */
  slots: MapVetoConfigSlot[];
}


export interface OwalStandingDay {
  tournament: Tournament;
  team: string;
  role: string;
  points: number;
  wins: number;
  draws: number;
  losses: number;
  win_rate: number;
}

export interface OwalStanding {
  user: User;
  role: string;
  division: number;
  days: Record<string, OwalStandingDay>;
  count_days: number;
  place: number;
  best_3_days: number;
  avg_points: number;
  wins: number;
  draws: number;
  losses: number;
  win_rate: number;
}

export interface OwalStandings {
  days: Tournament[];
  standings: OwalStanding[];
}

export interface Standings {
  id: number;
  tournament_id: number;
  team_id: number;
  stage_id: number | null;
  stage_item_id: number | null;
  position: number;
  overall_position: number;
  matches: number;
  win: number;
  draw: number;
  lose: number;
  points: number;
  buchholz: number | null;
  tb: number | null;
  score_differential: number | null;
  ranking_context: Record<string, string | number | null> | null;
  tb_metrics: Record<string, number | null> | null;
  source_rule_profile: string | null;
  tiebreak_order: string[] | null;

  team: Team | null;
  tournament: Tournament | null;
  stage: Stage | null;
  stage_item: StageItem | null;
  group?: TournamentGroup | null;
  group_id?: number;
  matches_history: Encounter[];
}

export interface OwalStack {
  user_1: User;
  user_2: User;
  games: number;
  avg_position: number;
}


// ─── Generic pick-ban engine (map + hero) ───────────────────────────────────
//
// Mirrors backend `PickBanSession`/`PickBanEntry`/`build_pick_ban_state` (see
// docs/plans/2026-08-09-generic-pickban-engine.md). Deliberately NOT reusing
// the legacy `EncounterMapPoolState`/`EncounterMapPoolEntry` shapes above:
// `item_id` replaces `map_id` (a hero-kind pool has no map), entries carry
// `round` instead of `slot`, and a `protect` action + `team_id` have no
// analogue there. The legacy map-veto room is unmigrated and keeps using its
// own types until the cutover (Foundation phase, currently blocked).

export type PickBanKind = "map" | "hero";
export type PickBanAction = "ban" | "pick" | "protect";
export type PickBanEntryStatus = "available" | "picked" | "banned" | "protected" | "played";

export interface PickBanEntry {
  id: number;
  item_id: number;
  round: number | null;
  order: number;
  action_index: number | null;
  picked_by: "home" | "away" | "decider" | null;
  protected_by: "home" | "away" | null;
  status: PickBanEntryStatus;
  team_id: number | null;
}

export interface PickBanSession {
  id: number;
  kind: PickBanKind;
  status: MapVetoSessionStatus;
  first_side: "home" | "away" | null;
  /** True once a result-dependent rotation needs `elect_opener` to proceed. */
  awaiting_choice: boolean;
  /** Only the loser of the round that triggered `awaiting_choice` may `elect_opener`. */
  pending_loser_side: "home" | "away" | null;
  seed_source: VetoSeedSource;
  home_seed: number | null;
  away_seed: number | null;
  turn_timer_seconds: number | null;
  /**
   * The reserve item each in-play slot named, snapshotted when the session
   * was created — same string-keyed-by-position contract as
   * `EncounterVetoSession.slot_reserves`. Always null for `kind: "hero"`
   * (no reserve concept there); read via `pickBanReserveMap`.
   */
  slot_reserves: Record<string, number> | null;
  started_at: string | null;
  current_step_started_at: string | null;
}

/** One captain's independent claim of ONE map's score (`EncounterMapReport`). */
export interface PickBanMapReport {
  map_id: number;
  side: "home" | "away";
  home_score: number;
  away_score: number;
}

export interface PickBanState {
  session: PickBanSession | null;
  /** Set only when `session` is null — same contract as `EncounterMapPoolState.reason`. */
  reason?: VetoUnavailableReason;
  /** Whether each side's captain has confirmed readiness to begin the
   * encounter's pre-game phase — set regardless of `session`, so the room
   * can render "waiting for the other captain" even before a session exists. */
  readiness: { home: boolean; away: boolean };
  sequence: string[];
  pool: PickBanEntry[];
  viewer_side: "home" | "away" | null;
  viewer_can_act: boolean;
  allowed_actions: PickBanAction[];
  current_step_index: number | null;
  current_step: string | null;
  expected_action: PickBanAction | "decider" | null;
  turn_side: "home" | "away" | null;
  current_round: number | null;
  is_complete: boolean;
  /**
   * Per-map result claims filed for this encounter, `kind: "map"` only (a hero
   * session has no results of its own). Drives the loop's third phase: a map is
   * picked, its heroes are banned, then it is played and BOTH captains report
   * it — and that confirmation is what opens the next map's bans.
   */
  map_reports?: PickBanMapReport[];
}

/** Side-agnostic step tokens, adds `protect_*` to the legacy veto vocabulary. */
export type PickBanSequenceToken =
  | "ban_first"
  | "ban_second"
  | "pick_first"
  | "pick_second"
  | "protect_first"
  | "protect_second"
  | "decider";

/** Only `"higher_seed"` exists today; kept as a union (not a literal) since
 * the backend models it as an extensible enum. */
export type PickBanFirstPickRule = "higher_seed";
/** `encounter_same_side` excludes an item only for the side that
 * banned/protected it — the opponent may still target it. `encounter`
 * excludes it for BOTH sides once anyone has. */
export type PickBanNoRepeatScope = "none" | "encounter" | "encounter_same_side";
/**
 * Wider than the legacy veto config's `FirstBanRotation` (`fixed`|`alternate`
 * only, backed by its own narrower `tournament.firstbanrotation` PG enum) —
 * `PickBanConfig.first_ban_rotation` is backed by a separate
 * `tournament.pickbanrotation` PG enum that also carries the
 * result-dependent rotations the elect_opener flow needs.
 */
export type PickBanFirstBanRotation =
  | "fixed"
  | "alternate"
  | "result_winner_first"
  | "result_loser_first"
  | "result_loser_choice";

/** One slot of a slot-mode `PickBanConfig`, as the admin CRUD serializer returns it. */
export interface PickBanConfigSlot {
  position: number;
  reserve_item_id: number | null;
  candidates: number[];
}

export interface PickBanConfig {
  id: number;
  tournament_id: number;
  kind: PickBanKind;
  stage_id: number | null;
  round: number | null;
  mode: MapVetoMode;
  first_pick_rule: PickBanFirstPickRule;
  first_ban_rotation: PickBanFirstBanRotation;
  turn_timer_seconds: number | null;
  preset: string | null;
  sequence: PickBanSequenceToken[];
  no_repeat_scope: PickBanNoRepeatScope;
  /** Only `"role"` is implemented server-side today; null disables the check. */
  unique_attribute_per_side_per_round: string | null;
  allow_protect: boolean;
  item_ids: number[];
  slots: PickBanConfigSlot[];
}

export interface PickBanConfigUpsertInput {
  kind: PickBanKind;
  stage_id?: number | null;
  round?: number | null;
  mode: MapVetoMode;
  first_pick_rule?: PickBanFirstPickRule;
  first_ban_rotation?: PickBanFirstBanRotation;
  preset?: string | null;
  turn_timer_seconds?: number | null;
  no_repeat_scope?: PickBanNoRepeatScope;
  unique_attribute_per_side_per_round?: string | null;
  allow_protect?: boolean;
  sequence?: PickBanSequenceToken[];
  item_ids?: number[];
  slots?: { candidates: number[]; reserve_item_id?: number | null }[];
}