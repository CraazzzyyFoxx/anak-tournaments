import type { PickBanConfigUpsertInput } from "@/types/tournament.types";

/**
 * One `PickBanConfig` a room authors for itself.
 *
 * Every field of the admin upsert except its scope: a room's config is always
 * pinned to the room's own stage with no round, and the server owns both — the
 * stage does not exist yet when this payload is built.
 */
type ScrimPoolConfigInput = Omit<PickBanConfigUpsertInput, "stage_id" | "round">;

/**
 * Where a room's pick-ban rules come from, discriminated on `source`.
 *
 * `copy` names a level of an existing tournament and lets the server resolve it
 * through the usual round > stage > tournament cascade, so the caller does not
 * have to know which level actually carries the config.
 */
export type ScrimPoolInput =
  | {
      source: "copy";
      tournament_id: number;
      /** Null copies whatever the tournament level resolves to. */
      stage_id: number | null;
      /** Null copies the stage level. Ignored without a `stage_id`. */
      round: number | null;
    }
  | { source: "custom"; configs: ScrimPoolConfigInput[] };

export interface ScrimCreateInput {
  workspace_id: number;
  label: string;
  best_of: number;
  /** Slot order: the creator's team first, the opponent's second. */
  team_names: [string, string];
  pool: ScrimPoolInput;
}

/**
 * Which rooms a list call asks for: the viewer's own, or every room of the
 * workspace (staff only — the server 403s a member without `match.result`).
 */
export type ScrimListScope = "mine" | "workspace";

interface ScrimTeam {
  slot: number;
  id: number;
  name: string;
  /** False while the slot is still open to the link's next taker. */
  captain_claimed: boolean;
}

export interface ScrimRoom {
  id: number;
  /** The share token. URL-safe, at most 32 chars — a path segment, not an id. */
  token: string;
  label: string;
  workspace_id: number;
  /** The room's owner discipline: scoped metadata reads use it, never a browsing choice. */
  discipline: string;
  tournament_id: number;
  stage_id: number;
  /** What `PregameRoom` runs on; the room UI needs nothing else. */
  encounter_id: number;
  best_of: number;
  /** Always two, slot 1 (the creator's team) first. */
  teams: ScrimTeam[];
  /** The slot the viewer captains, or null for a spectator. */
  viewer_slot: number | null;
  /** True only for a workspace member who captains neither side while one is open. */
  can_claim: boolean;
  /**
   * Whether the viewer may retire this room: its creator, a captain of either
   * side, or workspace staff holding `match.result`. False once closed — the UI
   * shows Close from this alone and never re-derives the rule.
   */
  can_close: boolean;
  created_at: string;
  closed_at: string | null;
}
