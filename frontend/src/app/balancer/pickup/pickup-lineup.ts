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

/** One assigned seat in a balanced team, flattened out of the role buckets. */
export type PickupSeat = {
  uuid: string;
  name: string;
  role: RoleCode;
  rating: number | null;
  /** The solver put them off their first choice. */
  offRole: boolean;
  isFlex: boolean;
  isCaptain: boolean;
  subRole: string | null;
};

export type PickupTeam = {
  id: number;
  averageRank: number | null;
  seats: PickupSeat[];
};

export type PickupVariantStats = {
  compositeScore: number | null;
  mmrStdDev: number | null;
  ratingGap: number | null;
  offRoleCount: number | null;
  benchedCount: number;
};

export type PickupVariant = {
  teams: PickupTeam[];
  stats: PickupVariantStats;
  benched: string[];
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value != null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function parseSeats(roster: Record<string, unknown>): PickupSeat[] {
  const seats: PickupSeat[] = [];
  for (const [name, group] of Object.entries(roster)) {
    // The solver keys buckets by its own role vocabulary (`Tank`/`Damage`/…
    // for tournaments, `tank`/`dps`/… for pickup masks); both normalise here.
    const role = canonicalToRegistrationRole(name);
    if (role == null || !Array.isArray(group)) {
      continue;
    }
    for (const entry of group) {
      const player = asRecord(entry);
      if (player?.uuid == null) {
        continue;
      }
      const preferences = Array.isArray(player.role_preferences) ? player.role_preferences : [];
      const isFlex = player.is_flex === true;
      seats.push({
        uuid: String(player.uuid),
        name: typeof player.name === "string" ? player.name : String(player.uuid),
        role,
        rating: asNumber(player.assigned_rating),
        // A flex player is never off-role: any seat is their first choice.
        offRole: !isFlex && preferences.length > 0 && preferences[0] !== name,
        isFlex,
        isCaptain: player.is_captain === true,
        subRole: typeof player.sub_role === "string" ? player.sub_role : null,
      });
    }
  }
  // Canonical role order, so the same team reads the same way every render.
  return seats.sort((a, b) => LINEUP_ROLES.indexOf(a.role) - LINEUP_ROLES.indexOf(b.role));
}

/**
 * Every balance option the solver returned, richest-first as it stored them.
 *
 * `run_balance` wraps its output as `{variants: [...]}`, and each variant is a
 * `teams_to_json` payload. An unrecognised shape yields an empty list rather
 * than throwing, so a result written by an older solver degrades to "no teams
 * to show" instead of blanking the screen.
 */
export function parseVariants(resultJson: unknown): PickupVariant[] {
  const root = asRecord(resultJson);
  if (root == null) {
    return [];
  }
  const payloads = Array.isArray(root.variants) ? root.variants : [root];
  const out: PickupVariant[] = [];
  for (const payload of payloads) {
    const variant = asRecord(payload);
    const teams = variant == null ? null : variant.teams;
    if (!Array.isArray(teams)) {
      continue;
    }
    const statistics = asRecord(variant?.statistics) ?? {};
    const benchedRows = Array.isArray(variant?.benched_players) ? variant.benched_players : [];
    out.push({
      teams: teams.flatMap((entry, index) => {
        const team = asRecord(entry);
        const roster = asRecord(team?.roster);
        if (team == null || roster == null) {
          return [];
        }
        return [
          {
            id: asNumber(team.id) ?? index + 1,
            averageRank: asNumber(team.average_mmr),
            seats: parseSeats(roster),
          },
        ];
      }),
      stats: {
        compositeScore: asNumber(statistics.composite_score),
        mmrStdDev: asNumber(statistics.mmr_std_dev),
        ratingGap: asNumber(statistics.max_total_rating_gap),
        offRoleCount: asNumber(statistics.off_role_count),
        benchedCount: benchedRows.length,
      },
      benched: benchedRows.flatMap((entry) => {
        const player = asRecord(entry);
        return player?.name == null ? [] : [String(player.name)];
      }),
    });
  }
  return out;
}
