import type {
  AdminRegistration,
  BalancerPlayerRecord,
  InternalBalancePayload,
  InternalBalancePlayer
} from "@/types/balancer-admin.types";
import type { PlayerValidationIssue } from "@/components/balancer/workspace-helpers";
import { getActiveRoleEntries } from "@/components/balancer/workspace-helpers";
import { answerList } from "@/lib/forms/answers";

export type { PlayerValidationIssue };

export type PlayerValidationState = {
  player: BalancerPlayerRecord;
  issues: PlayerValidationIssue[];
};

export type PoolLane = "excluded" | "needs_fix" | "ready";
export type PoolDropPatch = { is_in_pool: boolean };
export type PoolView = "all" | "needs_fix" | "ready" | "excluded" | "rank_delta";
export type PoolSortValue =
  | "added_desc"
  | "added_asc"
  | "name_asc"
  | "division_asc"
  | "division_desc";

export const POOL_LANES: PoolLane[] = ["excluded", "needs_fix", "ready"];

export const POOL_LANE_LABELS: Record<PoolLane, string> = {
  excluded: "Excluded",
  needs_fix: "Need Fix",
  ready: "Ready"
};

/**
 * Issue codes that are purely informational — extra balancing context, not a blocking rule.
 * They still surface as chips and in the Rank Δ view, but must NOT push a player into the
 * Need Fix lane. The rank-delta warning is advisory: a large gap between the balancer rank and
 * the OW rank is something to be aware of when balancing, not a problem that has to be fixed.
 */
const NON_BLOCKING_ISSUE_CODES: ReadonlySet<PlayerValidationIssue["code"]> = new Set([
  "rank_delta_warning"
]);

function isBlockingIssue(issue: PlayerValidationIssue): boolean {
  return !NON_BLOCKING_ISSUE_CODES.has(issue.code);
}

/** Whether a player has any issue that should move them into the Need Fix lane. */
export function hasBlockingIssues(issues: PlayerValidationIssue[]): boolean {
  return issues.some(isBlockingIssue);
}

export function derivePoolLane(state: PlayerValidationState): PoolLane {
  if (!state.player.is_in_pool) {
    return "excluded";
  }

  return hasBlockingIssues(state.issues) ? "needs_fix" : "ready";
}

export function getPoolDropPatch(targetLane: PoolLane): PoolDropPatch {
  return { is_in_pool: targetLane !== "excluded" };
}

/** Every BattleTag the registration carries — its primary handle first, the
 *  smurfs after — deduplicated case-insensitively. `fallbackBattleTag` stands
 *  in when there is no registration behind the row, or it answered no
 *  Battle.net identity at all. */
export function getRegistrationBattleTags(
  registration: Pick<AdminRegistration, "answers"> | null | undefined,
  fallbackBattleTag: string
): string[] {
  const handles = registration ? answerList(registration.answers, "identity_battlenet") : [];
  const seen = new Set<string>();
  const tags = [handles[0] ?? fallbackBattleTag, ...handles.slice(1)]
    .map((tag) => tag?.trim())
    .filter((tag): tag is string => Boolean(tag));

  return tags.filter((tag) => {
    const normalizedTag = tag.toLowerCase();
    if (seen.has(normalizedTag)) {
      return false;
    }
    seen.add(normalizedTag);
    return true;
  });
}

export function formatBattleTagsForClipboard(battleTags: string[]): string {
  return battleTags.join("\n");
}

export function formatSmurfCount(count: number): string {
  return `${count} smurf${count === 1 ? "" : "s"}`;
}

export const PRESET_LABELS: Record<string, string> = {
  CUSTOM: "Custom",
  DEFAULT: "Standard",
  PREFERENCE_FOCUSED: "Preference Focused",
  COMBINED: "Combined",
  HIGH_QUALITY: "High Quality"
};

export const TEAM_BADGE_ACCENTS = [
  "border-blue-400/20 bg-blue-500/10 text-blue-200",
  "border-rose-400/20 bg-rose-500/10 text-rose-200",
  "border-emerald-400/20 bg-emerald-500/10 text-emerald-200",
  "border-amber-400/20 bg-amber-500/10 text-amber-200",
  "border-violet-400/20 bg-violet-500/10 text-violet-200",
  "border-cyan-400/20 bg-cyan-500/10 text-cyan-200",
  "border-lime-400/20 bg-lime-500/10 text-lime-200",
  "border-fuchsia-400/20 bg-fuchsia-500/10 text-fuchsia-200",
  "border-pink-400/20 bg-pink-500/10 text-pink-200",
  "border-indigo-400/20 bg-indigo-500/10 text-indigo-200"
];

export const PANEL_CLASS = "rounded-xl border border-border bg-card";

/**
 * Secondary-control chrome for the whole tool. `rounded-lg` steps down from the
 * `rounded-xl` panels these sit in, and every surface is a token: the previous
 * `bg-black/15` / `hover:bg-white/[0.05]` pair was re-typed by hand in nine
 * files and workspace theming cannot reach a raw alpha wash.
 */
export const MUTED_BUTTON_CLASS =
  "rounded-lg border-[color:var(--aqt-border-2)] bg-[color:var(--aqt-bg-2)] text-[color:var(--aqt-fg-muted)] hover:bg-[color:var(--aqt-overlay-3)] hover:text-[color:var(--aqt-fg)]";

/** `MUTED_BUTTON_CLASS` at the tool's dense toolbar height. */
export const TOOLBAR_BUTTON_CLASS = `h-8 px-3 text-sm ${MUTED_BUTTON_CLASS}`;

/** Square icon-button chrome shared by both balancer sidebars. */
export const ICON_BUTTON_CLASS =
  "h-8 w-8 rounded-lg border border-[color:var(--aqt-border)] bg-[color:var(--aqt-bg-2)] text-[color:var(--aqt-fg-muted)] hover:bg-[color:var(--aqt-overlay-3)] hover:text-[color:var(--aqt-fg)]";

/**
 * `Name#1234` → a bright name plus a dim `#1234`, so a row reads as one
 * identity instead of one long string with the discriminator competing for
 * attention. Tags without a discriminator come back whole.
 */
export function splitBattleTag(battleTag: string): { name: string; suffix: string | null } {
  const index = battleTag.lastIndexOf("#");
  if (index <= 0) return { name: battleTag, suffix: null };
  return { name: battleTag.slice(0, index), suffix: battleTag.slice(index) };
}

export function createVariantLabel(index: number): string {
  return `Balance ${index}`;
}

function getPrimaryDivision(player: BalancerPlayerRecord): number {
  const activeEntries = getActiveRoleEntries(player.role_entries_json);
  if (activeEntries.length === 0) return Number.POSITIVE_INFINITY;
  return activeEntries[0]?.division_number ?? Number.POSITIVE_INFINITY;
}

export function sortPlayerStates(
  playerStates: PlayerValidationState[],
  sortValue: PoolSortValue
): PlayerValidationState[] {
  return [...playerStates].sort((left, right) => {
    if (sortValue === "name_asc") {
      return left.player.battle_tag.localeCompare(right.player.battle_tag);
    }
    if (sortValue === "division_asc") {
      return getPrimaryDivision(left.player) - getPrimaryDivision(right.player);
    }
    if (sortValue === "division_desc") {
      return getPrimaryDivision(right.player) - getPrimaryDivision(left.player);
    }
    if (sortValue === "added_asc") {
      return left.player.id - right.player.id;
    }
    return right.player.id - left.player.id;
  });
}

export function calculateTeamAverageFromPayload(
  team: InternalBalancePayload["teams"][number]
): number {
  return Math.round(calculateTeamAverageValueFromPayload(team));
}

export function calculateTeamAverageValueFromPayload(
  team: InternalBalancePayload["teams"][number]
): number {
  const totalPlayers = countTeamPlayers(team);
  if (totalPlayers === 0) return 0;
  return calculateTeamTotalFromPayload(team) / totalPlayers;
}

/** Every player of a team, whichever bucket (role or open slot) of the owner game holds them. */
function teamPlayers(team: InternalBalancePayload["teams"][number]): InternalBalancePlayer[] {
  return Object.values(team.roster).flat();
}

export function calculateTeamTotalFromPayload(
  team: InternalBalancePayload["teams"][number]
): number {
  return teamPlayers(team).reduce((sum, player) => sum + player.assigned_rating, 0);
}

export function countTeamPlayers(team: InternalBalancePayload["teams"][number]): number {
  return teamPlayers(team).length;
}

export function calculateOffRoleCountFromPayload(
  team: InternalBalancePayload["teams"][number]
): number {
  return Object.entries(team.roster).reduce(
    (sum, [roleKey, players]) =>
      sum +
      players.filter((player) => {
        if (player.is_flex) {
          return false;
        }
        const preferredRole = player.role_preferences[0];
        return Boolean(preferredRole) && preferredRole !== roleKey;
      }).length,
    0
  );
}

/**
 * Sample standard deviation. Mirrors the backend `_sample_stdev_from_sums`
 * (Bessel-corrected, like Python's `statistics.stdev`); returns 0 for < 2 values.
 */
export function sampleStdDev(values: number[]): number {
  const n = values.length;
  if (n < 2) {
    return 0;
  }
  const sum = values.reduce((acc, value) => acc + value, 0);
  const sumOfSquares = values.reduce((acc, value) => acc + value * value, 0);
  const variance = (sumOfSquares - (sum * sum) / n) / (n - 1);
  return variance > 0 ? Math.sqrt(variance) : 0;
}

/** Intra-team rating spread (mirrors backend `Team.intra_std`). */
export function calculateTeamVarianceFromPayload(
  team: InternalBalancePayload["teams"][number]
): number {
  return sampleStdDev(teamPlayers(team).map((player) => player.assigned_rating));
}

/** Total and max role-discomfort across a team (mirrors `Team.discomfort` / `max_pain`). */
export function calculateTeamDiscomfortFromPayload(
  team: InternalBalancePayload["teams"][number]
): { total: number; max: number } {
  let total = 0;
  let max = 0;
  for (const player of teamPlayers(team)) {
    const discomfort = player.role_discomfort ?? 0;
    total += discomfort;
    if (discomfort > max) {
      max = discomfort;
    }
  }
  return { total, max };
}

/**
 * Sub-role collisions within a team: for each (role, sub_role) pair occurring
 * more than once, add C(n, 2). Mirrors `result_serializer.teams_to_json`.
 */
export function calculateSubRoleCollisionsFromPayload(
  team: InternalBalancePayload["teams"][number]
): number {
  let collisions = 0;
  for (const players of Object.values(team.roster)) {
    const counts = new Map<string, number>();
    for (const player of players) {
      const subRole = player.sub_role;
      if (!subRole) {
        continue;
      }
      counts.set(subRole, (counts.get(subRole) ?? 0) + 1);
    }
    for (const occurrences of counts.values()) {
      if (occurrences > 1) {
        collisions += (occurrences * (occurrences - 1)) / 2;
      }
    }
  }
  return collisions;
}
