import {
  BalancerPlayerRecord,
  BalancerPlayerRoleEntry,
  BalancerRoleCode,
  InternalBalancePayload,
  SavedBalance,
} from "@/types/balancer-admin.types";
import { BalanceResponse } from "@/types/balancer.types";
import { UserRoleType } from "@/types/user.types";
import userService from "@/services/user.service";

export type BalanceVariant = {
  id: string;
  label: string;
  payload: InternalBalancePayload;
  source: "saved" | "generated";
};

export function sortRoleEntries(entries: BalancerPlayerRoleEntry[]): BalancerPlayerRoleEntry[] {
  return [...entries].sort((a, b) => a.priority - b.priority);
}

export function playerHasRankedRole(player: BalancerPlayerRecord): boolean {
  return player.role_entries_json.some((entry) => entry.rank_value !== null);
}

export function normalizeInternalPayload(payload: InternalBalancePayload): InternalBalancePayload {
  return {
    ...payload,
    teams: payload.teams.map((team, index) => ({
      ...team,
      id: team.id ?? index + 1,
      roster: {
        Tank: team.roster.Tank ?? [],
        Damage: team.roster.Damage ?? [],
        Support: team.roster.Support ?? [],
      },
    })),
  };
}

export function buildVariantFromSavedBalance(balance: SavedBalance): BalanceVariant {
  return {
    id: `saved-${balance.id}`,
    label: `Saved balance #${balance.id}`,
    payload: normalizeInternalPayload(balance.result_json),
    source: "saved",
  };
}

export function convertBalanceResponseToInternalPayload(response: BalanceResponse): InternalBalancePayload {
  return normalizeInternalPayload({
    teams: response.teams.map((team) => ({
      id: team.id,
      name: team.name,
      avgMMR: team.avgMMR,
      variance: team.variance,
      totalDiscomfort: team.totalDiscomfort,
      maxDiscomfort: team.maxDiscomfort,
      roster: {
        Tank: team.roster.Tank ?? [],
        Damage: team.roster.Damage ?? [],
        Support: team.roster.Support ?? [],
      },
    })),
    statistics: response.statistics,
  });
}

export function buildBalancerInput(players: BalancerPlayerRecord[]): Record<string, unknown> {
  const payload = players.reduce<Record<string, unknown>>((accumulator, player) => {
    const roleEntries = sortRoleEntries(player.role_entries_json);
    const hasRankedRole = roleEntries.some((entry) => entry.rank_value !== null);
    if (!hasRankedRole) {
      return accumulator;
    }

    const toClassConfig = (role: "tank" | "dps" | "support") => {
      const roleEntry = roleEntries.find((entry) => entry.role === role);
      return {
        isActive: Boolean(roleEntry?.rank_value),
        rank: roleEntry?.rank_value ?? 0,
        priority: roleEntry?.priority ?? 99,
      };
    };

    accumulator[String(player.id)] = {
      identity: {
        name: player.battle_tag,
      },
      stats: {
        classes: {
          tank: toClassConfig("tank"),
          dps: toClassConfig("dps"),
          support: toClassConfig("support"),
        },
      },
    };
    return accumulator;
  }, {});

  return {
    format: "xv-1",
    players: payload,
  };
}

export function buildTeamNamesText(payload: InternalBalancePayload | null): string {
  if (!payload) {
    return "";
  }
  return payload.teams.map((team) => team.name.split("#")[0]).join("\n");
}

export function downloadPayload(payload: InternalBalancePayload, tournamentId: number | null) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `balancer-${tournamentId ?? "draft"}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}

const DIVISION_THRESHOLDS_HELPER: Array<{ division: number; minRank: number }> = [
  { division: 1, minRank: 2000 },
  { division: 2, minRank: 1900 },
  { division: 3, minRank: 1800 },
  { division: 4, minRank: 1700 },
  { division: 5, minRank: 1600 },
  { division: 6, minRank: 1500 },
  { division: 7, minRank: 1400 },
  { division: 8, minRank: 1300 },
  { division: 9, minRank: 1200 },
  { division: 10, minRank: 1100 },
  { division: 11, minRank: 1000 },
  { division: 12, minRank: 900 },
  { division: 13, minRank: 800 },
  { division: 14, minRank: 700 },
  { division: 15, minRank: 600 },
  { division: 16, minRank: 500 },
  { division: 17, minRank: 400 },
  { division: 18, minRank: 300 },
  { division: 19, minRank: 200 },
  { division: 20, minRank: 0 },
];

function resolveDivisionFromRankHelper(rankValue: number | null): number | null {
  if (rankValue == null) return null;
  for (const { division, minRank } of DIVISION_THRESHOLDS_HELPER) {
    if (rankValue >= minRank) return division;
  }
  return 20;
}

/**
 * Converts a map of { role -> SR rank } to a sorted BalancerPlayerRoleEntry[].
 * Priority is assigned in ROLE_ORDER order: tank=1, dps=2, support=3.
 */
const ROLE_ORDER: BalancerRoleCode[] = ["tank", "dps", "support"];

export function buildRoleEntriesFromRankHistory(
  history: Partial<Record<BalancerRoleCode, number>>,
): BalancerPlayerRoleEntry[] {
  const entries: BalancerPlayerRoleEntry[] = [];
  let priority = 1;
  for (const role of ROLE_ORDER) {
    const rankValue = history[role] ?? null;
    if (rankValue === null) continue;
    entries.push({
      role,
      subtype: null,
      priority: priority++,
      rank_value: rankValue,
      division_number: resolveDivisionFromRankHelper(rankValue),
    });
  }
  return entries;
}

const USER_ROLE_TO_BALANCER: Record<UserRoleType, BalancerRoleCode> = {
  Tank: "tank",
  Damage: "dps",
  Support: "support",
};

/**
 * Looks up a player's rank history from past tournaments.
 * Returns a map of { balancer role code -> SR rank } using the latest tournament per role.
 * Returns null if the user cannot be found.
 */
export async function fetchPlayerRankHistory(
  battleTag: string,
): Promise<Partial<Record<BalancerRoleCode, number>> | null> {
  try {
    const lookupName = battleTag.replace("#", "-");
    const user = await userService.getUserByName(lookupName);
    if (!user?.id) return null;

    const tournaments = await userService.getUserTournaments(user.id);
    if (!tournaments?.length) return null;

    // For each tournament, find this user's own Player record to get their rank (SR).
    // UserTournament already has role + division scoped to this user at the top level,
    // but rank (SR) lives inside players[].
    // Sort tournaments descending by number so we process newest first.
    const sorted = [...tournaments].sort((a, b) => b.number - a.number);

    const latestPerRole: Partial<Record<BalancerRoleCode, number>> = {};

    for (const tournament of sorted) {
      const roleName = tournament.role as UserRoleType;
      const roleCode = USER_ROLE_TO_BALANCER[roleName];
      if (!roleCode) continue;
      // Already have a (newer) entry for this role
      if (latestPerRole[roleCode] !== undefined) continue;

      // Find this user's own Player record in the roster
      const playerRecord = tournament.players.find(
        (p) => p.user_id === user.id,
      );
      const rankValue = playerRecord?.rank ?? null;
      if (rankValue !== null && rankValue > 0) {
        latestPerRole[roleCode] = rankValue;
      }
    }

    return Object.keys(latestPerRole).length > 0 ? latestPerRole : null;
  } catch {
    return null;
  }
}
