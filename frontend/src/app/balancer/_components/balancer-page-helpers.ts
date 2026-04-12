import type { BalancerRoleCode, BalancerPlayerRecord, InternalBalancePayload } from "@/types/balancer-admin.types";
import type { BalanceVariant, PlayerValidationIssue } from "./workspace-helpers";
import { getActiveRoleEntries } from "./workspace-helpers";

export type { BalanceVariant, PlayerValidationIssue };

export type PlayerValidationState = {
  player: BalancerPlayerRecord;
  issues: PlayerValidationIssue[];
};

export type PoolView = "all" | "needs_fix" | "ready" | "excluded";
export type PoolSortValue = "added_desc" | "name_asc" | "division_asc" | "division_desc";

export const PRESET_LABELS: Record<string, string> = {
  DEFAULT: "Standard",
  COMPETITIVE: "Competitive",
  CASUAL: "Casual",
  QUICK: "Quick",
  PREFERENCE_FOCUSED: "Preference Focused",
  HIGH_QUALITY: "High Quality",
  CPSAT: "CP-SAT (Exact)",
};

export const ROLE_ACCENTS: Record<BalancerRoleCode, { text: string; card: string }> = {
  tank: {
    text: "text-sky-300",
    card: "border-sky-300/20 bg-sky-500/10 text-sky-200",
  },
  dps: {
    text: "text-orange-300",
    card: "border-orange-300/20 bg-orange-500/10 text-orange-200",
  },
  support: {
    text: "text-emerald-300",
    card: "border-emerald-300/20 bg-emerald-500/10 text-emerald-200",
  },
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
  "border-indigo-400/20 bg-indigo-500/10 text-indigo-200",
];

export const PANEL_CLASS =
  "rounded-[28px] border border-white/8 bg-[#11101f] shadow-[0_18px_60px_rgba(0,0,0,0.24)]";

export const MUTED_BUTTON_CLASS =
  "rounded-xl border-white/10 bg-black/15 text-white/70 hover:bg-white/[0.05] hover:text-white";

export function createVariantLabel(index: number): string {
  return `Balance ${index}`;
}

export function splitBattleTag(battleTag: string): { name: string; suffix: string | null } {
  const hashIndex = battleTag.indexOf("#");
  if (hashIndex < 0) {
    return { name: battleTag, suffix: null };
  }
  return {
    name: battleTag.slice(0, hashIndex),
    suffix: battleTag.slice(hashIndex),
  };
}

export function formatSubtypeLabel(subtype: string | null | undefined): string | null {
  if (!subtype) return null;
  return subtype
    .split("_")
    .map((token) => token.charAt(0).toUpperCase() + token.slice(1))
    .join(" ");
}

export function getPrimaryDivision(player: BalancerPlayerRecord): number {
  const activeEntries = getActiveRoleEntries(player.role_entries_json);
  if (activeEntries.length === 0) return Number.POSITIVE_INFINITY;
  return activeEntries[0]?.division_number ?? Number.POSITIVE_INFINITY;
}

export function sortPlayerStates(
  playerStates: PlayerValidationState[],
  sortValue: PoolSortValue,
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
    return right.player.id - left.player.id;
  });
}

export function calculateTeamAverageFromPayload(
  team: InternalBalancePayload["teams"][number],
): number {
  const players = [...team.roster.Tank, ...team.roster.Damage, ...team.roster.Support];
  if (players.length === 0) return 0;
  return Math.round(players.reduce((sum, player) => sum + player.rating, 0) / players.length);
}

export function countTeamPlayers(team: InternalBalancePayload["teams"][number]): number {
  return team.roster.Tank.length + team.roster.Damage.length + team.roster.Support.length;
}

export function findPlayerAssignment(
  payload: InternalBalancePayload | null,
  selectedPlayerId: number | null,
): {
  teamId: number;
  teamName: string;
  roleKey: "Tank" | "Damage" | "Support";
  teamIndex: number;
} | null {
  if (!payload || selectedPlayerId == null) return null;
  for (const [teamIndex, team] of payload.teams.entries()) {
    for (const roleKey of Object.keys(team.roster) as Array<"Tank" | "Damage" | "Support">) {
      if (team.roster[roleKey].some((player) => Number(player.uuid) === selectedPlayerId)) {
        return { teamId: team.id, teamName: team.name, roleKey, teamIndex };
      }
    }
  }
  return null;
}
