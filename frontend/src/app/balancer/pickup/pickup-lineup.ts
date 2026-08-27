import { ROLES, canonicalToRegistrationRole, type RoleCode } from "@/lib/roles";
import { isRosterSlotCode, type RosterSlotMap } from "@/lib/roster-shape";
import { sanitizeBalancerConfig } from "@/app/balancer/components/balancer-config-helpers";
import type {
  CustomGameOutcome,
  CustomGamePlayer,
  CustomGamePlayerPatch,
  RotationRecommendation,
} from "@/services/custom-game.service";
import type { BalancerConfig } from "@/types/balancer.types";

/** What recording a match needs: the click, and which balance option it was played from. */
export type PickupRecordOutcomeInput = {
  outcome: CustomGameOutcome;
  variantIndex: number;
  mapId: number | null;
};

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

/** Canonical role order — the order role columns and glyph rails are read in. */
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
 * The roles the balancer may use for this row, in the order the host set them.
 *
 * A stored `null` means "not configured yet", which the backend expands to
 * every role the player has a rank for — mirror that here so the UI shows the
 * same set the balance would use. Position is the balancer's priority: the
 * first role in the array is the one the solver tries to seat the player in
 * first (see `CustomGamePlayer.roles`), so this is also the only order the UI
 * ever shows or writes. Reordering happens through an explicit drag in the
 * player sheet, never by re-deriving it from a rank — a rank fix and a
 * priority choice are two different decisions a host makes at two different
 * times, and folding one into the other means neither survives a moment the
 * host isn't actively looking at this row.
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

/**
 * Turn one role on or off within a stored priority order.
 *
 * The order *is* the balancer's priority, so a role that turns on lands at the
 * end of it rather than being resorted — the host's existing order for the
 * other roles is left exactly as they set it.
 */
export function toggleRole(order: readonly RoleCode[], role: RoleCode): RoleCode[] {
  return order.includes(role) ? order.filter((item) => item !== role) : [...order, role];
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
  row: Pick<CustomGamePlayer, "display_name" | "battle_tag" | "workspace_member_id">,
): string {
  return row.display_name || row.battle_tag || `#${row.workspace_member_id}`;
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

/**
 * A 5v5 mix needs one tank and two of each damage/support per team, so the
 * lineup needs twice that before a balance can seat everyone. Hard-coded
 * because the pickup solver runs the same 1-2-2 shape for every mix; a
 * configurable role lock would come from `config_json`, which no mix sets yet.
 */
const ROLE_DEMAND: Record<RoleCode, number> = { tank: 2, dps: 4, support: 4 };

/**
 * Seats a balance can actually fill — the sum of the demand above.
 *
 * The add-players dialog counts against this rather than against a literal 10 so
 * the "you are two over a full lobby" line and the role gauges below it can
 * never disagree about how big a lobby is.
 */
export const LOBBY_SIZE: number = Object.values(ROLE_DEMAND).reduce((sum, need) => sum + need, 0);

export type RoleSupply = {
  role: RoleCode;
  /** Active players who both selected this role and carry a rank for it. */
  supply: number;
  need: number;
  /** How many more the solver would want; 0 once the role is covered. */
  short: number;
};

/**
 * Who can actually fill each role, counted the way the solver counts.
 *
 * A selected role with no rank is not supply — the balance refuses to seat it —
 * so this deliberately does not match "how many chips are lit".
 */
export function summarizeRoleSupply(rows: CustomGamePlayer[]): RoleSupply[] {
  return LINEUP_ROLES.map((role) => {
    const supply = rows.filter(
      (row) => row.is_active && resolveRoleOrder(row).includes(role) && row.ranks[role] != null,
    ).length;
    const need = ROLE_DEMAND[role];
    return { role, supply, need, short: Math.max(0, need - supply) };
  });
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

/**
 * The three columns the lineup panel drags players between. `must_play`
 * guarantees a seat (see `CustomGamePlayer.must_play`), `pool` is active but
 * optional, `benched` is `is_active === false`. A row's bucket is a pure
 * function of those two server fields -- there is no fourth state to drift
 * out of sync with them.
 */
export type LineupBucket = "must_play" | "pool" | "benched";

export function lineupBucket(row: Pick<CustomGamePlayer, "is_active" | "must_play">): LineupBucket {
  if (!row.is_active) {
    return "benched";
  }
  return row.must_play ? "must_play" : "pool";
}

/**
 * The `is_active`/`must_play` pair a drop onto one of the three lineup
 * columns writes. Benching always clears `must_play` too -- a player sitting
 * out cannot simultaneously be guaranteed a seat.
 */
export function bucketPatch(bucket: LineupBucket): CustomGamePlayerPatch {
  switch (bucket) {
    case "must_play":
      return { is_active: true, must_play: true };
    case "pool":
      return { is_active: true, must_play: false };
    case "benched":
      return { is_active: false, must_play: false };
  }
}

/** One roster patch `applyRotationHints` fires for one row. */
export type RotationHintPatch = { workspaceMemberId: number; patch: CustomGamePlayerPatch };

/**
 * The patches that bring the lineup in line with the rotation-fairness read
 * (`mix_rotation.recommend_rotation`): `must_play` moves the member into the
 * Must Play column (`bucketPatch("must_play")`) -- the recommendation is the
 * whole reason to act on it, so the seat it grants is guaranteed exactly
 * like a host's own drag into that column -- and `should_rest` benches them
 * exactly like a manual drop into `Benched` (`bucketPatch("benched")`, which
 * also clears any existing pin). A row already matching its hint, or with no
 * hint at all (`neutral`, or not loaded yet), gets no patch -- applying is
 * always idempotent.
 */
export function computeRotationHintPatches(
  rows: readonly CustomGamePlayer[],
  recommendations: readonly RotationRecommendation[],
): RotationHintPatch[] {
  const hintByMember = new Map(recommendations.map((rec) => [rec.workspace_member_id, rec]));
  const patches: RotationHintPatch[] = [];
  for (const row of rows) {
    const hint = hintByMember.get(row.workspace_member_id);
    if (!hint) continue;
    if (hint.status === "must_play" && !(row.is_active && row.must_play)) {
      patches.push({ workspaceMemberId: row.workspace_member_id, patch: bucketPatch("must_play") });
    } else if (hint.status === "should_rest" && (row.is_active || row.must_play)) {
      patches.push({ workspaceMemberId: row.workspace_member_id, patch: bucketPatch("benched") });
    }
  }
  return patches;
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
  /** The host's override, or the computed `Team N` default. */
  name: string;
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

/**
 * A host's team-name overrides, keyed by 0-based team index — the same
 * position `parseVariants` below assigns names by. Stored in `config_json`
 * (`custom.set_team_names`) rather than in the solver's own result, so a
 * rename survives paging between balance options and re-running the solver.
 */
export function parseTeamNames(configJson: unknown): Record<number, string> {
  const raw = asRecord(asRecord(configJson)?.team_names);
  if (raw == null) {
    return {};
  }
  const out: Record<number, string> = {};
  for (const [key, value] of Object.entries(raw)) {
    const index = Number(key);
    if (Number.isInteger(index) && index >= 0 && typeof value === "string" && value.trim()) {
      out[index] = value;
    }
  }
  return out;
}

/**
 * The mix's own roster-shape override, straight off `config_json.role_mask`
 * (`custom.set_role_mask`). `null` means "no override" — `balance` falls back
 * through the workspace default to the built-in Overwatch 5v5 shape, and
 * `CustomGame.roster_shape` reports whichever one actually won.
 */
export function parseRoleMask(configJson: unknown): RosterSlotMap | null {
  const raw = asRecord(asRecord(configJson)?.role_mask);
  if (raw == null) {
    return null;
  }
  const out: RosterSlotMap = {};
  for (const [code, value] of Object.entries(raw)) {
    if (isRosterSlotCode(code) && Number.isInteger(value) && (value as number) > 0) {
      out[code] = value as number;
    }
  }
  return Object.keys(out).length > 0 ? out : null;
}

/**
 * The host's rank-adjustment-per-win knob, straight off
 * `config_json.points_per_win` (`custom.set_points_per_win`). `null` means
 * "disabled" -- recording a win/loss then leaves every rank untouched.
 */
export function parsePointsPerWin(configJson: unknown): number | null {
  const value = asRecord(configJson)?.points_per_win;
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : null;
}

/**
 * The mix's own balancer algorithm overrides -- every `config_json` key
 * `balance` forwards straight to the solver as `config_overrides`
 * (`custom_game.py`'s `_CONFIG_ONLY` carves out the four keys below, which
 * this mix's own controls own). Sanitized the same way the tournament
 * balancer page sanitizes a saved config, so a stray or legacy key never
 * reaches the field editor.
 */
const MIX_CONFIG_RESERVED_KEYS: Record<string, true> = {
  role_mask: true,
  team_count: true,
  team_names: true,
  points_per_win: true,
};

export function parseBalancerConfig(configJson: unknown): BalancerConfig {
  const raw = asRecord(configJson) ?? {};
  const overrides = Object.fromEntries(
    Object.entries(raw).filter(([key]) => !MIX_CONFIG_RESERVED_KEYS[key]),
  );
  return sanitizeBalancerConfig(overrides as BalancerConfig);
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
export function parseVariants(resultJson: unknown, teamNames: Record<number, string> = {}): PickupVariant[] {
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
      teams: teams
        .flatMap((entry) => {
          const team = asRecord(entry);
          const roster = asRecord(team?.roster);
          if (team == null || roster == null) {
            return [];
          }
          return [{ id: asNumber(team.id), averageRank: asNumber(team.average_mmr), seats: parseSeats(roster) }];
        })
        // Named by final render position, not the raw payload index: a
        // malformed entry dropped above must not shift every name after it.
        .map((team, index) => ({
          ...team,
          id: team.id ?? index + 1,
          name: teamNames[index] ?? `Team ${index + 1}`,
        })),
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
