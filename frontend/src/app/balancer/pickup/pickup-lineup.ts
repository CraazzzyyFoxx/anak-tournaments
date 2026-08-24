import { ROLES, canonicalToRegistrationRole, type RoleCode } from "@/lib/roles";
import type { CustomGamePlayer } from "@/services/custom-game.service";

/**
 * Lineup rules for a pickup mix, kept pure so the panels stay presentational.
 *
 * Two pools exist: the workspace **player pool** (everyone the workspace knows)
 * and the mix **lineup** (who is in this mix). Membership and participation are
 * separate: `is_active === false` benches a player without dropping their rank
 * override or role order, so a host can toggle a late arrival on and off
 * without rebuilding anything.
 *
 * Role vocabulary is `@/lib/roles` — the same `tank`/`dps`/`support` codes the
 * balancer and the registration form use.
 */

/** Canonical role order, used wherever no host ordering exists yet. */
export const LINEUP_ROLES: readonly RoleCode[] = ROLES.map((role) => role.code);

export const PICKUP_STATUS_LABELS: Record<string, string> = {
  draft: "Draft",
  balanced: "Balanced",
  completed: "Completed",
  cancelled: "Cancelled",
};

/** A terminal mix is read-only server-side, so its write controls are hidden. */
export const PICKUP_TERMINAL_STATUSES: Record<string, true> = { completed: true, cancelled: true };

/**
 * The role order the balancer will see, highest priority first.
 *
 * A stored `null` means "not configured yet", which the backend expands to
 * every role the player has a rank for — mirror that here so the UI shows the
 * same set the balance would use.
 */
export function resolveRoleOrder(row: Pick<CustomGamePlayer, "roles" | "ranks">): RoleCode[] {
  if (row.roles == null) {
    return LINEUP_ROLES.filter((role) => row.ranks[role] != null);
  }
  const seen = new Set<string>();
  const out: RoleCode[] = [];
  for (const code of row.roles) {
    const role = LINEUP_ROLES.find((item) => item === code);
    if (role == null || seen.has(role)) {
      continue;
    }
    seen.add(role);
    out.push(role);
  }
  return out;
}

/** Toggle one role off, or append it as the lowest priority when it is off. */
export function toggleRole(order: RoleCode[], role: RoleCode): RoleCode[] {
  return order.includes(role) ? order.filter((item) => item !== role) : [...order, role];
}

/** Move a role one step up (`-1`) or down (`+1`) the priority order. */
export function moveRole(order: RoleCode[], role: RoleCode, delta: -1 | 1): RoleCode[] {
  const from = order.indexOf(role);
  const to = from + delta;
  if (from === -1 || to < 0 || to >= order.length) {
    return order;
  }
  const next = [...order];
  next.splice(from, 1);
  next.splice(to, 0, role);
  return next;
}

export type LineupIssue = "no_role" | "no_rank";

export const LINEUP_ISSUE_MESSAGES: Record<LineupIssue, string> = {
  no_role: "No roles selected — balance will reject this mix",
  no_rank: "No rank on any selected role — balance will reject this mix",
};

/**
 * What would make `balance` reject this row. An active player with no playable
 * ranked role fails the whole run server-side (`missing_ranked_role`), so it is
 * worth showing before the host presses Balance.
 */
export function getLineupIssue(row: CustomGamePlayer): LineupIssue | null {
  if (!row.is_active) {
    return null;
  }
  const order = resolveRoleOrder(row);
  if (order.length === 0) {
    return row.roles == null ? "no_rank" : "no_role";
  }
  return order.some((role) => row.ranks[role] != null) ? null : "no_rank";
}

/** One label rule shared by the lineup, the teams and the sheet. */
export function playerLabel(
  row: Pick<CustomGamePlayer, "display_name" | "battle_tag" | "workspace_player_id">,
): string {
  return row.display_name || row.battle_tag || `#${row.workspace_player_id}`;
}

/** Mean effective rank across the roles the player can actually be assigned. */
export function averageRank(row: Pick<CustomGamePlayer, "roles" | "ranks">): number | null {
  const values = resolveRoleOrder(row)
    .map((role) => row.ranks[role])
    .filter((value): value is number => value != null);
  if (values.length === 0) {
    return null;
  }
  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

export type LineupSummary = {
  total: number;
  active: number;
  benched: number;
  blocking: number;
};

export function summarizeLineup(rows: CustomGamePlayer[]): LineupSummary {
  let active = 0;
  let blocking = 0;
  for (const row of rows) {
    if (row.is_active) {
      active += 1;
    }
    if (getLineupIssue(row) != null) {
      blocking += 1;
    }
  }
  return { total: rows.length, active, benched: rows.length - active, blocking };
}

/** Active players first, then the host's own ordering. */
export function sortLineup(rows: CustomGamePlayer[]): CustomGamePlayer[] {
  return [...rows].sort((a, b) => {
    if (a.is_active !== b.is_active) {
      return a.is_active ? -1 : 1;
    }
    return a.sort_order - b.sort_order || a.id - b.id;
  });
}

export type PickupTeam = {
  index: number;
  players: CustomGamePlayer[];
  averageRank: number | null;
};

/**
 * Teams as the last balance assigned them, read from `team_index` on the rows.
 * A benched or unassigned row has no `team_index` and is simply absent.
 */
export function groupTeams(rows: CustomGamePlayer[]): PickupTeam[] {
  const byTeam = new Map<number, CustomGamePlayer[]>();
  for (const row of rows) {
    if (row.team_index == null) {
      continue;
    }
    const bucket = byTeam.get(row.team_index);
    if (bucket) {
      bucket.push(row);
    } else {
      byTeam.set(row.team_index, [row]);
    }
  }
  return [...byTeam.entries()]
    .sort(([a], [b]) => a - b)
    .map(([index, players]) => {
      const ranks = players.map(averageRank).filter((value): value is number => value != null);
      return {
        index,
        players: sortLineup(players),
        averageRank:
          ranks.length === 0 ? null : Math.round(ranks.reduce((sum, value) => sum + value, 0) / ranks.length),
      };
    });
}

/**
 * Which role the last balance gave each player, keyed by `workspace_player_id`.
 *
 * `team_index` on the rows is the authoritative team membership; this only adds
 * the slot the solver picked, which lives solely in the raw result payload
 * under its canonical role names (`Tank`/`Damage`/`Support`). An unrecognised
 * shape yields an empty map rather than throwing, so a result written by an
 * older solver degrades to "team known, role unknown".
 */
export function parseAssignedRoles(resultJson: unknown): Record<string, RoleCode> {
  const out: Record<string, RoleCode> = {};
  if (resultJson == null || typeof resultJson !== "object") {
    return out;
  }
  const root = resultJson as Record<string, unknown>;
  const variants = root.variants;
  const payload = (
    Array.isArray(variants) && variants.length > 0 ? variants[0] : root
  ) as Record<string, unknown> | null;
  const teams = payload?.teams;
  if (!Array.isArray(teams)) {
    return out;
  }
  for (const team of teams) {
    const roster = (team as Record<string, unknown> | null)?.roster;
    if (roster == null || typeof roster !== "object" || Array.isArray(roster)) {
      continue;
    }
    for (const [name, group] of Object.entries(roster as Record<string, unknown>)) {
      const role = canonicalToRegistrationRole(name);
      if (role == null || !Array.isArray(group)) {
        continue;
      }
      for (const entry of group) {
        const uuid = (entry as Record<string, unknown> | null)?.uuid;
        if (uuid != null) {
          out[String(uuid)] = role;
        }
      }
    }
  }
  return out;
}
