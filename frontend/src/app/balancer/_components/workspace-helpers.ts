import {
  BalancerPlayerRecord,
  BalancerPlayerRoleEntry,
  InternalBalancePayload,
  SavedBalance,
} from "@/types/balancer-admin.types";
import { BalanceResponse } from "@/types/balancer.types";

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
