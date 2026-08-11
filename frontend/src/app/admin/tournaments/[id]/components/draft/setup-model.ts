import type { RosterShape } from "@/lib/roster-shape";
import type {
  DraftCaptainOrder,
  DraftFormat,
  DraftRole,
  DraftStatus
} from "@/types/draft.types";

// The backend does not cap team_count (it flows through settings_json);
// this is a UI sanity bound only.
export const MIN_DRAFT_TEAM_COUNT = 2;
export const MAX_DRAFT_TEAM_COUNT = 32;

export const SETUP_STEPS = [
  "config",
  "pool",
  "captains",
  "order",
  "review",
  "ready"
] as const;

export type DraftSetupStep = (typeof SETUP_STEPS)[number];

export function canNavigateToSetupStep(
  current: DraftSetupStep,
  target: DraftSetupStep
): boolean {
  return target !== "ready" && SETUP_STEPS.indexOf(target) <= SETUP_STEPS.indexOf(current);
}

export function previousSetupStep(current: DraftSetupStep): DraftSetupStep {
  const currentIndex = SETUP_STEPS.indexOf(current);
  return SETUP_STEPS[Math.max(0, currentIndex - 1)];
}

export function canCancelDraftSetup(
  current: DraftSetupStep,
  sessionStatus: DraftStatus | null
): boolean {
  if (sessionStatus === "setup" || sessionStatus === "ready") return true;
  return sessionStatus == null && current !== "config";
}

export interface DraftPoolCandidate {
  id: number;
  roles: DraftRole[];
  rank: number | null;
  hasAccount: boolean;
  excluded: boolean;
}

export interface DraftPoolReadiness {
  requiredPlayers: number;
  actualPlayers: number;
  missingRanks: number;
  missingAccounts: number;
  excludedPlayers: number;
  roleCoverage: Record<DraftRole, number>;
  blockers: string[];
}

export interface DraftScheduleRound {
  round: number;
  teamIds: number[];
  rule: string;
}

export interface DraftSetupValidationState {
  pickTimeSeconds: number;
  captainIds: number[];
  poolReady: boolean;
  previewFeasible: boolean;
}

export function derivePoolReadiness(
  candidates: DraftPoolCandidate[],
  teamCount: number,
  shape: RosterShape
): DraftPoolReadiness {
  const included = candidates.filter((candidate) => !candidate.excluded);
  const roleCoverage: Record<DraftRole, number> = { tank: 0, dps: 0, support: 0 };
  for (const candidate of included) {
    for (const role of new Set(candidate.roles)) {
      roleCoverage[role] += 1;
    }
  }
  const requiredPlayers = Math.max(0, teamCount) * shape.team_size;
  const blockers: string[] = [];
  if (included.length < requiredPlayers) blockers.push("not_enough_players");
  // The per-role targets ARE the server's roster shape. A code the shape does
  // not ask for has a target of 0 and can never be short; flex slots take any
  // role, so they never name one here.
  for (const role of ["tank", "dps", "support"] as const) {
    if (roleCoverage[role] < (shape.slots[role] ?? 0) * teamCount) {
      blockers.push(`role_shortage:${role}`);
    }
  }
  return {
    requiredPlayers,
    actualPlayers: included.length,
    missingRanks: included.filter((candidate) => candidate.rank == null).length,
    missingAccounts: included.filter((candidate) => !candidate.hasAccount).length,
    excludedPlayers: candidates.length - included.length,
    roleCoverage,
    blockers
  };
}

export type DraftCaptainSort = "rank_desc" | "rank_asc" | "name";

export interface DraftCaptainRow {
  id: number;
  label: string;
  roles: DraftRole[];
  rank: number | null;
}

/**
 * Search + role filter + sort for the captain picker.
 *
 * Roles are OR-ed and an empty selection means "any role", so unchecking every
 * role never hides the whole pool. Unranked players sort last in BOTH rank
 * directions: a missing rank is unknown, not zero, so it must not win the
 * strongest seat by accident nor the weakest one.
 */
export function filterCaptainRows(
  rows: readonly DraftCaptainRow[],
  filters: { query: string; roles: readonly DraftRole[]; sort: DraftCaptainSort }
): DraftCaptainRow[] {
  const needle = filters.query.trim().toLocaleLowerCase();
  const matched = rows.filter(
    (row) =>
      (filters.roles.length === 0 || filters.roles.some((role) => row.roles.includes(role))) &&
      (needle === "" || row.label.toLocaleLowerCase().includes(needle))
  );
  if (filters.sort === "name") {
    return matched.sort((left, right) => left.label.localeCompare(right.label));
  }
  const direction = filters.sort === "rank_desc" ? -1 : 1;
  return matched.sort((left, right) => {
    if (left.rank == null || right.rank == null) {
      return left.rank == null ? (right.rank == null ? 0 : 1) : -1;
    }
    return (left.rank - right.rank) * direction;
  });
}

export function moveCaptain(ids: number[], activeId: number, overId: number): number[] {
  const from = ids.indexOf(activeId);
  const to = ids.indexOf(overId);
  if (from < 0 || to < 0 || from === to) return ids;
  const next = [...ids];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

export function orderCaptainIds(
  ids: number[],
  order: DraftCaptainOrder,
  ranks: ReadonlyMap<number, number | null>,
  seed: number
): number[] {
  if (order === "manual") return [...ids];
  if (order === "weakest_first" || order === "strongest_first") {
    const direction = order === "weakest_first" ? 1 : -1;
    return [...ids].sort((left, right) => {
      const leftRank = ranks.get(left) ?? -1;
      const rightRank = ranks.get(right) ?? -1;
      return ((leftRank - rightRank) || left - right) * direction;
    });
  }

  // Mulberry32 keeps the UI preview stable and sends the same seed to the server.
  let state = seed >>> 0;
  const random = () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
  const shuffled = [...ids];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const target = Math.floor(random() * (index + 1));
    [shuffled[index], shuffled[target]] = [shuffled[target], shuffled[index]];
  }
  return shuffled;
}

export function buildDraftSchedule(
  teamIds: number[],
  rounds: number,
  format: DraftFormat,
  roundRules: string[]
): DraftScheduleRound[] {
  return Array.from({ length: rounds }, (_, index) => {
    const round = index + 1;
    const customRule = roundRules[index] ?? "linear";
    const reverse =
      format === "snake" ? index % 2 === 1 : format === "custom" && customRule === "reverse";
    return {
      round,
      teamIds: reverse ? [...teamIds].reverse() : [...teamIds],
      rule: format === "snake" ? (reverse ? "reverse" : "linear") : format === "custom" ? customRule : "linear"
    };
  });
}

export function validateSetupStep(
  step: DraftSetupStep,
  state: DraftSetupValidationState
): string[] {
  const errors: string[] = [];
  if (step === "config") {
    if (state.pickTimeSeconds < 10 || state.pickTimeSeconds > 600) {
      errors.push("pick_time_out_of_range");
    }
  }
  if (step === "pool" && !state.poolReady) errors.push("pool_not_ready");
  if (step === "captains" && state.captainIds.length === 0) errors.push("captains_required");
  if (step === "review" && !state.previewFeasible) errors.push("preview_infeasible");
  return errors;
}
