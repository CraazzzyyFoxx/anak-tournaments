import type { DivisionGrid } from "@/types/workspace.types";
import type { DisciplineMetadata } from "@/types/discipline.types";
import { ratedDimension, registrationRoles, slotRank, type RoleOntology } from "@/lib/roster/ontology";
import { roleOf, toRoleRef, type RoleRef } from "@/lib/roster/role-ref";
import { OPEN_SLOT_CODE, solverSlotCode, type RosterShape } from "@/lib/roster/shape";
import {
  RANK_SOURCE_LABELS,
  type CustomGameOutcome,
  type CustomGameParticipationEntry,
  type CustomGamePlayer,
  type CustomGamePlayerPatch,
  type CustomGameSettings,
  type MixParticipation,
  type RankSource,
  type RotationRecommendation,
} from "@/services/custom-game.service";

/** What recording a match needs: the click, which balance option it was played from, and whose lobby it was. */
export type PickupRecordOutcomeInput = {
  outcome: CustomGameOutcome;
  variantIndex: number;
  lobbyIndex: number;
};

/**
 * Lineup rules for a pickup mix, kept pure so the panels stay presentational.
 *
 * Two pools exist: the workspace **player pool** (everyone the workspace knows)
 * and the mix **lineup** (who is in this mix). Membership and participation are
 * separate: `participation === "benched"` sits a player out without dropping
 * their rank override or role order, so a host can toggle a late arrival on and
 * off without rebuilding anything.
 *
 * Role vocabulary is the mix owner's game (`MixOwner`): its rated roles, in the order its ontology declares them.
 */

/** The role references a stored order writes: leaf refs of the owner's rated dimension, nothing guessed. */
export function roleRefsOf(order: readonly string[], dimension: string): RoleRef[] {
  return order.map((code) => toRoleRef(code, null, dimension));
}

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
export function resolveRoleOrder(row: Pick<CustomGamePlayer, "roles" | "ranks">, roles: readonly string[]): string[] {
  if (row.roles == null) {
    // Ranked roles in the game's declared order (`roles`); a rank key the dictionary does not list sorts last.
    return Object.keys(row.ranks)
      .filter((role) => row.ranks[role] != null)
      .sort((a, b) => slotRank(roles, a) - slotRank(roles, b));
  }
  // The server validated every reference against the game's roles; the host's order is kept as stored. The open
  // slot (`flex`) is a seat, never a role a player can be ordered on.
  return [...new Set(row.roles.map((ref) => roleOf(ref)).filter((code) => code !== OPEN_SLOT_CODE))];
}

/**
 * Turn one role on or off within a stored priority order.
 *
 * The order *is* the balancer's priority, so a role that turns on lands at the
 * end of it rather than being resorted — the host's existing order for the
 * other roles is left exactly as they set it.
 */
export function toggleRole(order: readonly string[], role: string): string[] {
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
export function getLineupIssue(row: CustomGamePlayer, roles: readonly string[]): LineupIssue | null {
  if (row.participation === "benched") {
    return null;
  }
  const order = resolveRoleOrder(row, roles);
  if (order.length === 0) {
    return row.roles == null ? "no_rank" : "no_role";
  }
  return order.some((role) => row.ranks[role] != null) ? null : "no_rank";
}

/** One label rule shared by the lineup, the teams and the sheet. */
export function playerLabel(
  row: Pick<CustomGamePlayer, "display_name" | "identity" | "workspace_member_id">,
): string {
  return row.display_name || row.identity?.handle || `#${row.workspace_member_id}`;
}

/** Mean effective rank across the roles the player can actually be assigned. */
export function averageRank(row: Pick<CustomGamePlayer, "roles" | "ranks">, roles: readonly string[]): number | null {
  const values = resolveRoleOrder(row, roles)
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

export function summarizeLineup(rows: CustomGamePlayer[], roles: readonly string[]): LineupSummary {
  let active = 0;
  let blocking = 0;
  for (const row of rows) {
    if (row.participation !== "benched") {
      active += 1;
    }
    if (getLineupIssue(row, roles) != null) {
      blocking += 1;
    }
  }
  return { total: rows.length, active, benched: rows.length - active, blocking };
}

/**
 * Lobbies are two teams. A mix's format fixes the seats of ONE team, so one lobby needs twice that before a balance
 * can seat everyone, and a mix running several lobbies asks for the same shape once per lobby.
 */
export const TEAMS_PER_LOBBY = 2;

/**
 * The mix owner's game, as the lineup reads it: the game's roles in declared order, what one lobby asks of each role
 * (from the mix's own frozen roster shape, never a fixed table), the lobby size and the grid its ranks are on.
 * Everything is empty/`null` while the owner's metadata is still loading -- nothing is guessed in the meantime.
 */
export type MixOwner = {
  /** The owner's role dictionary: names, glyphs and tints of its roles. `null` until it loads. */
  ontology: RoleOntology | null;
  /** The game's own name, for labels that say where a rank came from. */
  gameName: string | null;
  /** The game's name when it collects a live native rank (a rank to read beside the author's), else `null`. */
  nativeRankName: string | null;
  /** The rated dimension role references are written in. `null` until metadata loads, so nothing writes a guess. */
  dimension: string | null;
  /** Roles a lineup row may play, in the game's declared order. */
  roles: readonly string[];
  /** Seats ONE lobby needs per role (`TEAMS_PER_LOBBY ×` the shape's slots); roles the format has no seat for are absent. */
  demand: Readonly<Record<string, number>>;
  /** Seats one lobby's balance can actually fill (`TEAMS_PER_LOBBY × team_size`); `null` while the shape is unknown. */
  lobbySize: number | null;
  /** The grid a mix's ranks are on: the owner game's effective grid in the mix's workspace. */
  grid: DivisionGrid;
};

/** The owner view of one mix from its game's metadata and the mix's own roster shape. */
export function buildMixOwner(
  metadata: DisciplineMetadata | null | undefined,
  shape: RosterShape | null | undefined,
  grid: DivisionGrid,
): MixOwner {
  const ontology = metadata ?? null;
  const roles = registrationRoles(ontology).map((role) => role.code);
  const demand: Record<string, number> = {};
  for (const role of roles) {
    const seats = shape?.slots[role] ?? 0;
    if (seats > 0) {
      demand[role] = TEAMS_PER_LOBBY * seats;
    }
  }
  return {
    ontology,
    gameName: metadata?.discipline.name ?? null,
    nativeRankName: metadata?.discipline.capabilities.native_rank_collection ? metadata.discipline.name : null,
    dimension: ontology ? (ratedDimension(ontology)?.code ?? null) : null,
    roles,
    demand,
    lobbySize: shape ? TEAMS_PER_LOBBY * shape.team_size : null,
    grid,
  };
}

/** Where a rank came from, in the owner's words (`native` is the game's own ladder, named after the game). */
export function rankSourceLabel(source: RankSource, gameName: string | null): string {
  return source === "native" ? (gameName ?? RANK_SOURCE_LABELS.native) : RANK_SOURCE_LABELS[source];
}

export type RoleSupply = {
  role: string;
  /** Active players who both selected this role and carry a rank for it. */
  supply: number;
  need: number;
  /** How many more the solver would want; 0 once the role is covered. */
  short: number;
};

/**
 * Who can actually fill each role the format asks for, counted the way the solver counts, against the demand of
 * every lobby the mix is running.
 *
 * A selected role with no rank is not supply — the balance refuses to seat it —
 * so this deliberately does not match "how many chips are lit".
 */
export function summarizeRoleSupply(rows: CustomGamePlayer[], owner: MixOwner, lobbyCount = 1): RoleSupply[] {
  return owner.roles
    .filter((role) => (owner.demand[role] ?? 0) > 0)
    .map((role) => {
      const supply = rows.filter(
        (row) =>
          row.participation !== "benched" &&
          resolveRoleOrder(row, owner.roles).includes(role) &&
          row.ranks[role] != null,
      ).length;
      const need = owner.demand[role] * lobbyCount;
      return { role, supply, need, short: Math.max(0, need - supply) };
    });
}

/** Active players first, then the host's own ordering. */
export function sortLineup(rows: CustomGamePlayer[]): CustomGamePlayer[] {
  return [...rows].sort((a, b) => {
    const aBenched = a.participation === "benched";
    const bBenched = b.participation === "benched";
    if (aBenched !== bBenched) {
      return aBenched ? 1 : -1;
    }
    return a.sort_order - b.sort_order || a.id - b.id;
  });
}

/** One roster row `applyRotationHints` moves. */
export type RotationHintPatch = { workspaceMemberId: number; patch: CustomGamePlayerPatch };

/**
 * Where each actionable rotation verdict wants the row. `neutral` is absent on
 * purpose: it is "no opinion", not a column to move anybody into.
 */
const PARTICIPATION_BY_HINT: Record<"must_play" | "should_rest", MixParticipation> = {
  must_play: "must_play",
  should_rest: "benched",
};

/**
 * The moves that bring the lineup in line with the rotation-fairness read
 * (`mix_rotation.recommend_rotation`): whoever is owed a seat is pinned, and
 * whoever should rest is benched -- each exactly like the host's own drag into
 * that column. A row already in its hinted column, or with no actionable hint,
 * is left alone, so applying is idempotent.
 */
export function computeRotationHintPatches(
  rows: readonly CustomGamePlayer[],
  recommendations: readonly RotationRecommendation[],
): RotationHintPatch[] {
  const hintByMember = new Map(recommendations.map((rec) => [rec.workspace_member_id, rec]));
  const patches: RotationHintPatch[] = [];
  for (const row of rows) {
    const status = hintByMember.get(row.workspace_member_id)?.status;
    const wanted = status == null || status === "neutral" ? null : PARTICIPATION_BY_HINT[status];
    if (wanted == null || wanted === row.participation) {
      continue;
    }
    patches.push({ workspaceMemberId: row.workspace_member_id, patch: { participation: wanted } });
  }
  return patches;
}

/** The same moves as one whole-lineup write (`customGameService.setParticipation`). */
export function participationEntries(
  patches: readonly RotationHintPatch[],
): CustomGameParticipationEntry[] {
  return patches.flatMap((entry) =>
    entry.patch.participation == null
      ? []
      : [{ workspace_member_id: entry.workspaceMemberId, participation: entry.patch.participation }],
  );
}

/** One assigned seat in a balanced team, flattened out of the role buckets. */
export type PickupSeat = {
  uuid: string;
  name: string;
  /** A role code of the owner game (lower-cased), or `flex` for an open seat. */
  role: string;
  rating: number | null;
  /**
   * The host's own open rating for that bucket, when the mix balanced in
   * ranker mode -- `rating` above is then the effective one the solver used.
   * `null` in points mode, where the two cannot differ.
   */
  openRating: number | null;
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
  /**
   * How this option scored against its siblings, lower is better. The mix
   * engine's own total (`mix_balancer_quality_total`), or the tournament GA's
   * knee score when a mix ran on that fallback -- both rank options of the
   * same run and neither means anything across runs, so one field carries
   * whichever the solver reported.
   */
  qualityScore: number | null;
  mmrStdDev: number | null;
  ratingGap: number | null;
  /**
   * Mean rank gap per role line between the two teams -- the metric a tank
   * mismatch shows up in and the team totals hide. Rating units: the server
   * rescales it out of the solver's canonical scale.
   */
  lineGap: number | null;
  offRoleCount: number | null;
  /**
   * Off-role seats above the pool's structural floor, i.e. the ones the solver
   * could actually have avoided. `0` with a non-zero count means the roster
   * simply cannot be seated any more comfortably.
   */
  offRoleAboveMinimum: number | null;
  /** Off-role seats no split of this pool can avoid. */
  offRoleFloor: number | null;
  subRoleCollisions: number | null;
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
 * A host's team-name overrides re-keyed by the position `parseVariants` assigns
 * names by -- which is a position INSIDE one lobby. Team names are stored
 * relationally (`custom.set_team_names`) at their global index
 * (`lobby_index * 2 + team`, so A: 0-1, B: 2-3, C: 4-5 …), so each lobby's
 * overrides shift down by its own offset and every other lobby's drop out.
 */
export function teamNamesByIndex(
  settings: CustomGameSettings | undefined,
  lobbyIndex = 0,
): Record<number, string> {
  const offset = lobbyIndex * 2;
  const out: Record<number, string> = {};
  for (const [key, value] of Object.entries(settings?.team_names ?? {})) {
    const index = Number(key) - offset;
    // Two teams per lobby, the same bound `discord_lineup` reads names with:
    // without it a lobby would pick up the overrides stored for another.
    if (Number.isInteger(index) && index >= 0 && index < 2 && value.trim()) {
      out[index] = value;
    }
  }
  return out;
}

/**
 * A role-keyed player map (`ratings`, `open_ratings`, `sub_roles`) read at the seat's normalized slot code, so a
 * legacy-capitalised key (`Top`) matches its lower-case seat exactly as the bucket itself does.
 */
function slotValue(map: Record<string, unknown> | null, role: string): unknown {
  if (map == null) return undefined;
  if (role in map) return map[role];
  for (const [key, value] of Object.entries(map)) {
    if (solverSlotCode(key) === role) return value;
  }
  return undefined;
}

function parseSeats(
  roster: Record<string, unknown>,
  players: Record<string, unknown>,
  roleOrder: readonly string[],
): PickupSeat[] {
  const seats: PickupSeat[] = [];
  for (const [name, group] of Object.entries(roster)) {
    // Every bucket is a seat group: the game's roles and the open slot alike. A bucket the owner's catalog does
    // not know still keeps its players (shown as an unknown role) instead of silently dropping them.
    const role = solverSlotCode(name);
    if (role === "" || !Array.isArray(group)) {
      continue;
    }
    for (const entry of group) {
      const uuid = typeof entry === "string" || typeof entry === "number" ? String(entry) : null;
      const player = uuid == null ? null : asRecord(players[uuid]);
      if (uuid == null || player == null) {
        continue;
      }
      const preferences = Array.isArray(player.role_preferences) ? player.role_preferences : [];
      const isFlex = player.is_flex === true;
      const subRole = slotValue(asRecord(player.sub_roles), role);
      const first = typeof preferences[0] === "string" ? solverSlotCode(preferences[0]) : null;
      seats.push({
        uuid,
        name: typeof player.name === "string" ? player.name : uuid,
        role,
        // The server's `seat_rating`: the rating for the bucket they sit in, 0 without one.
        rating: asNumber(slotValue(asRecord(player.ratings), role)) ?? 0,
        // Only written by the server when the host balanced in ranker mode.
        openRating: asNumber(slotValue(asRecord(player.open_ratings), role)),
        // A flex player is never off-role: any seat is their first choice -- and an open seat names no role.
        offRole: !isFlex && role !== OPEN_SLOT_CODE && first != null && first !== role,
        isFlex,
        isCaptain: player.is_captain === true,
        subRole: typeof subRole === "string" ? subRole : null,
      });
    }
  }
  // The game's declared role order, so the same team reads the same way every render.
  return seats.sort((a, b) => slotRank(roleOrder, a.role) - slotRank(roleOrder, b.role));
}

/**
 * Every balance option the solver returned, richest-first as it stored them.
 *
 * The mix carries the solver's lobby document (`lobby_document` server-side):
 * each player once under `players`, and each option only as role buckets of
 * player uuids plus its own numbers -- the seats are rebuilt against that map
 * here. An unrecognised shape yields an empty list rather than throwing, so a
 * malformed result degrades to "no teams to show" instead of blanking the screen.
 *
 * `roleOrder` is the owner game's declared slot order (`slotCodeOrder`); it only orders seats inside a team.
 */
export function parseVariants(
  resultJson: unknown,
  teamNames: Record<number, string> = {},
  roleOrder: readonly string[] = [],
): PickupVariant[] {
  const root = asRecord(resultJson);
  if (root == null || !Array.isArray(root.variants)) {
    return [];
  }
  const players = asRecord(root.players) ?? {};
  // One pool, one floor: the server hoists it out of the per-option numbers.
  const offRoleFloor = asNumber(asRecord(root.feasibility)?.structural_min_off_role);
  const out: PickupVariant[] = [];
  for (const payload of root.variants) {
    const variant = asRecord(payload);
    const teams = variant == null ? null : variant.teams;
    if (!Array.isArray(teams)) {
      continue;
    }
    const statistics = asRecord(variant?.statistics) ?? {};
    const benched = Array.isArray(variant?.benched) ? variant.benched : [];
    out.push({
      teams: teams
        .flatMap((entry) => {
          const team = asRecord(entry);
          const roster = asRecord(team?.roster);
          if (team == null || roster == null) {
            return [];
          }
          return [{ id: asNumber(team.id), averageRank: asNumber(team.average_mmr), seats: parseSeats(roster, players, roleOrder) }];
        })
        // Named by final render position, not the raw payload index: a
        // malformed entry dropped above must not shift every name after it.
        .map((team, index) => ({
          ...team,
          id: team.id ?? index + 1,
          name: teamNames[index] ?? `Team ${index + 1}`,
        })),
      stats: {
        // Whichever engine ran: `mix_balancer` scores a seating with its own
        // four-term total, the tournament GA (the fallback where the native
        // engine is unavailable) with a normalised knee score. Both are
        // cleared server-side once a host hand-swaps a seat, so a missing
        // value here means "no longer the solver's arrangement", not "zero".
        qualityScore:
          asNumber(statistics.mix_balancer_quality_total) ?? asNumber(statistics.composite_score),
        mmrStdDev: asNumber(statistics.mmr_std_dev),
        ratingGap: asNumber(statistics.max_total_rating_gap),
        lineGap: asNumber(statistics.mix_balancer_role_fairness),
        offRoleCount: asNumber(statistics.off_role_count),
        offRoleAboveMinimum: asNumber(statistics.off_role_above_minimum),
        offRoleFloor,
        subRoleCollisions: asNumber(statistics.sub_role_collision_count),
        benchedCount: benched.length,
      },
      benched: benched.flatMap((entry) => {
        const name = asRecord(players[String(entry)])?.name;
        return typeof name === "string" ? [name] : [];
      }),
    });
  }
  return out;
}
