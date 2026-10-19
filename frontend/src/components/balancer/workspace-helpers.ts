import {
  AdminRegistration,
  BalancerApplication,
  BalancerPlayerExportResponse,
  BalancerPlayerRecord,
  BalancerPlayerRoleEntry,
  BalancerRoleCode,
  BalancerRosterKey,
  InternalBalancePayload,
  InternalBalancePlayer,
  SavedBalance
} from "@/types/balancer-admin.types";
import { BalanceResponse, BalancerConfig } from "@/types/balancer.types";
import { OPEN_SLOT_CODE, solverSlotCode } from "@/lib/roster/shape";
import { roleOf, subRoleSlugOf } from "@/lib/roster/role-ref";
import type { DivisionGrid, DivisionGridVersion } from "@/types/workspace.types";
import { getDivisionLabel, resolveDivisionFromRank } from "@/lib/divisions/grid";
import userService from "@/services/user.service";
import balancerAdminService from "@/services/balancer-admin.service";
import { DivisionGridNormalizer } from "@/lib/divisions/grid-normalizer";
import { answerFlag, answerList, answerText } from "@/lib/forms/answers";
import { identityKey } from "@/lib/forms/builtin-keys";
import { normalizeSocialHandle } from "@/lib/social/providers";

/** Names a slot code for display: the owner game's role name, or the open-slot label (`useSlotLabel(ontology)`). */
export type SlotLabeler = (code: string) => string;

export type BalanceVariant = {
  id: string;
  label: string;
  payload: InternalBalancePayload;
  source: "saved" | "generated" | "imported";
  config?: BalancerConfig | null;
  /** Number of pool players excluded from this run due to validation issues */
  skippedCount?: number;
  /**
   * Payload edited in the editor since the variant was built. Only meaningful for
   * `source: "saved"`, where it separates "this is exactly what is persisted" from
   * "there is new work to save/export".
   */
  dirty?: boolean;
};

export type PlayerValidationIssue =
  | {
      code: "missing_ranked_role";
      message: string;
    }
  | {
      code: "application_role_mismatch";
      message: string;
      applicationRoleCodes: BalancerRoleCode[];
      playerRoleCodes: BalancerRoleCode[];
    }
  | {
      code: "rank_delta_warning";
      message: string;
      role: BalancerRoleCode;
      /** Division number of the balancer rank, in the workspace grid (for the icon). */
      currentDivision: number | null;
      /** Division number of the OW2 rank converted into the workspace grid (for the icon). */
      owDivision: number | null;
      /** Absolute rank-point delta between the two. */
      delta: number;
    }
  | {
      code: "status_blocks_ready";
      message: string;
    };

export type PlayerRankHistoryPreviewEntry = {
  role: BalancerRoleCode;
  rank_value: number;
  /** Division number in the workspace-default (target) grid — after cross-version normalisation. */
  division_number: number | null;
  /** Division number in the source tournament's own grid — before normalisation. */
  original_division_number: number | null;
  tournament_id: number | null;
  tournament_name: string | null;
  source_role: BalancerRoleCode | null;
  tournament_grid_version: DivisionGridVersion | null;
  /** Where this entry came from: balancer history or analytics (getUserTournaments). */
  source: "balancer" | "analytics";
};

export type PlayerRankHistoryPreview = {
  user_id: number;
  entries: PlayerRankHistoryPreviewEntry[];
  average_rank_value: number | null;
};

function sortRoleEntries(entries: BalancerPlayerRoleEntry[]): BalancerPlayerRoleEntry[] {
  return [...entries].sort((a, b) => a.priority - b.priority);
}

export function isRoleEntryActive(entry: BalancerPlayerRoleEntry): boolean {
  return entry.is_active;
}

export function getActiveRoleEntries(
  entries: BalancerPlayerRoleEntry[]
): BalancerPlayerRoleEntry[] {
  return sortRoleEntries(entries).filter((entry) => isRoleEntryActive(entry));
}

function playerHasRankedRole(player: BalancerPlayerRecord): boolean {
  return player.role_entries_json.some(
    (entry) => isRoleEntryActive(entry) && entry.rank_value !== null
  );
}

/** A registration role as a role code: the owner game's own lower-case code. The open slot and blanks name no role. */
function normalizeApplicationRole(role: string | null | undefined): BalancerRoleCode | null {
  const code = role ? solverSlotCode(role) : "";
  return code === "" || code === OPEN_SLOT_CODE ? null : code;
}

function uniqueRoleCodesInOrder(roleCodes: Iterable<BalancerRoleCode>): BalancerRoleCode[] {
  const seen = new Set<BalancerRoleCode>();
  const ordered: BalancerRoleCode[] = [];

  for (const roleCode of roleCodes) {
    if (seen.has(roleCode)) {
      continue;
    }
    seen.add(roleCode);
    ordered.push(roleCode);
  }

  return ordered;
}

function formatRoleCodes(roleCodes: Iterable<BalancerRoleCode>, slotLabel: SlotLabeler): string {
  const orderedRoleCodes = uniqueRoleCodesInOrder(roleCodes);

  if (orderedRoleCodes.length === 0) {
    return "None";
  }

  return orderedRoleCodes.map((roleCode) => slotLabel(roleCode)).join(" / ");
}

function getPlayerRoleCodes(player: BalancerPlayerRecord): BalancerRoleCode[] {
  return uniqueRoleCodesInOrder(
    getActiveRoleEntries(player.role_entries_json).map((entry) => entry.role)
  );
}

function getApplicationRoleCodes(
  application: BalancerApplication | null | undefined
): BalancerRoleCode[] {
  if (!application) {
    return [];
  }

  return uniqueRoleCodesInOrder(
    [application.primary_role, ...application.additional_roles_json]
      .map((role) => normalizeApplicationRole(role))
      .filter((role): role is BalancerRoleCode => role !== null)
  );
}

export function buildPlayerSearchIndex(
  player: BalancerPlayerRecord,
  application: BalancerApplication | null | undefined,
  slotLabel: SlotLabeler
): string {
  const roleEntries = sortRoleEntries(player.role_entries_json);
  const activeRoleEntries = roleEntries.filter((entry) => isRoleEntryActive(entry));
  const playerRoleLabels = activeRoleEntries.map((entry) => slotLabel(entry.role));
  const playerRoleCodes = activeRoleEntries.map((entry) => entry.role);
  const divisions = activeRoleEntries
    .map((entry) => entry.division_number)
    .filter((division): division is number => division !== null);
  const applicationRoleLabels = getApplicationRoleCodes(application).map((roleCode) =>
    slotLabel(roleCode)
  );

  return [
    player.identity,
    player.identity_key,
    ...player.additional_handles,
    player.is_flex ? "flex" : "",
    playerRoleLabels.join(" "),
    playerRoleCodes.join(" "),
    divisions.join(" "),
    application?.identity ?? "",
    applicationRoleLabels.join(" ")
  ]
    .join(" ")
    .trim()
    .toLowerCase();
}

function isFlexApplication(
  application: BalancerApplication | null | undefined,
  applicationRoleCodes: BalancerRoleCode[]
): boolean {
  return application?.primary_role == null && applicationRoleCodes.length > 0;
}

function roleSequencesMatch(
  application: BalancerApplication | null | undefined,
  isFlexPlayer: boolean,
  left: BalancerRoleCode[],
  right: BalancerRoleCode[]
): boolean {
  if (left.length === 0) {
    return false;
  }

  const primaryApplicationRole = normalizeApplicationRole(application?.primary_role);
  if (primaryApplicationRole) {
    return left.includes(primaryApplicationRole);
  }

  if (right.length === 0) {
    return true;
  }

  if (isFlexPlayer || isFlexApplication(application, right)) {
    return left.every((roleCode) => right.includes(roleCode));
  }

  return left.every((roleCode) => right.includes(roleCode));
}

interface RoleRankDelta {
  role: BalancerRoleCode;
  delta: number;
  /** Balancer rank for the role (workspace-grid points). */
  currentRank: number;
  /** OW2 rank converted into the workspace grid (points). */
  owRank: number;
}

/**
 * Absolute rank-point delta between the balancer rank and the (grid-normalised) OW rank for
 * every active ranked role that has both values. `ow_rank_value` is normalised to the workspace
 * grid server-side, so it shares the same scale as `rank_value` and subtraction is valid.
 */
function computeRankDeltasByRole(player: BalancerPlayerRecord): RoleRankDelta[] {
  return getActiveRoleEntries(player.role_entries_json)
    .filter((entry) => entry.rank_value !== null && entry.ow_rank_value !== null)
    .map((entry) => ({
      role: entry.role,
      delta: Math.abs((entry.rank_value as number) - (entry.ow_rank_value as number)),
      currentRank: entry.rank_value as number,
      owRank: entry.ow_rank_value as number
    }));
}

export function getPlayerValidationIssues(
  player: BalancerPlayerRecord,
  application: BalancerApplication | null | undefined,
  workspaceConfig: { rank_delta_threshold: number | null } | null | undefined,
  /** The owner game's grid and role names: what the issue messages quote ranks and roles in. */
  grid: DivisionGrid,
  slotLabel: SlotLabeler
): PlayerValidationIssue[] {
  const issues: PlayerValidationIssue[] = [];

  if (!playerHasRankedRole(player)) {
    issues.push({
      code: "missing_ranked_role",
      message: "No ranked roles configured"
    });
  }

  if (player.ready_blocked) {
    issues.push({
      code: "status_blocks_ready",
      message: "Current status blocks Ready"
    });
  }

  if (application) {
    const playerRoleCodes = getPlayerRoleCodes(player);
    const applicationRoleCodes = getApplicationRoleCodes(application);

    if (!roleSequencesMatch(application, player.is_flex, playerRoleCodes, applicationRoleCodes)) {
      issues.push({
        code: "application_role_mismatch",
        message: `Application: ${formatRoleCodes(applicationRoleCodes, slotLabel)}; balancer: ${formatRoleCodes(playerRoleCodes, slotLabel)}`,
        applicationRoleCodes,
        playerRoleCodes
      });
    }
  }

  if (workspaceConfig?.rank_delta_threshold != null) {
    const threshold = workspaceConfig.rank_delta_threshold;
    const violating = computeRankDeltasByRole(player)
      .filter((entry) => entry.delta > threshold)
      .sort((a, b) => b.delta - a.delta);
    // One chip per violating role, worst delta first.
    for (const entry of violating) {
      const currentDivision = resolveDivisionFromRank(grid, entry.currentRank);
      const owDivision = resolveDivisionFromRank(grid, entry.owRank);
      const currentLabel = getDivisionLabel(grid, currentDivision) ?? String(entry.currentRank);
      const owLabel = getDivisionLabel(grid, owDivision) ?? String(entry.owRank);
      issues.push({
        code: "rank_delta_warning",
        role: entry.role,
        currentDivision,
        owDivision,
        delta: entry.delta,
        message: `${slotLabel(entry.role)}: ${currentLabel} → ${owLabel} (Δ${entry.delta} pts)`
      });
    }
  }

  return issues;
}

/** A role-keyed map re-keyed by lower-case slot code. */
function rekeyBySlotCode<T>(map: Record<string, T>): Record<string, T> {
  return Object.fromEntries(Object.entries(map).map(([role, value]) => [solverSlotCode(role), value]));
}

/**
 * A player carries three role-keyed fields besides its bucket, and all three are compared against roster keys
 * downstream (drop eligibility, off-role badges, re-rating on move), so they are re-keyed together with the bucket.
 */
function normalizeRosterPlayer(player: InternalBalancePlayer): InternalBalancePlayer {
  const normalized: InternalBalancePlayer = {
    ...player,
    role_preferences: player.role_preferences.map((role) => solverSlotCode(role))
  };
  if (player.all_ratings) normalized.all_ratings = rekeyBySlotCode(player.all_ratings);
  if (player.all_discomforts) normalized.all_discomforts = rekeyBySlotCode(player.all_discomforts);
  return normalized;
}

/**
 * The editor's payload from any spelling of a balance. A balance response is keyed by the roster slot codes of the
 * tournament's own format (`shared/domain/roster_shape.py`: the owner game's lower-case role codes and `flex`), but
 * the solver echoes the spelling of the mask it was given and a balance saved by an older editor says `Tank` for
 * `tank`. So every bucket is keyed by its lower-case slot code (both spellings are one bucket), a player's
 * role-keyed fields follow, and every team carries every bucket any team fields — no player of any game is
 * dropped, and a move never meets a missing bucket.
 */
export function normalizeInternalPayload(payload: InternalBalancePayload): InternalBalancePayload {
  const rosters = payload.teams.map((team) => {
    const roster: Record<BalancerRosterKey, InternalBalancePlayer[]> = {};
    for (const [key, players] of Object.entries(team.roster)) {
      (roster[solverSlotCode(key)] ??= []).push(...(players ?? []).map(normalizeRosterPlayer));
    }
    return roster;
  });
  const keys = [...new Set(rosters.flatMap((roster) => Object.keys(roster)))];

  return {
    ...payload,
    teams: payload.teams.map((team, index) => ({
      ...team,
      id: team.id ?? index + 1,
      roster: Object.fromEntries(keys.map((key) => [key, rosters[index][key] ?? []]))
    })),
    ...(payload.benched_players ? { benched_players: payload.benched_players.map(normalizeRosterPlayer) } : {})
  };
}

export function buildVariantFromSavedBalance(balance: SavedBalance): BalanceVariant {
  return {
    id: `saved-${balance.id}`,
    label: `Saved balance #${balance.id}`,
    payload: normalizeInternalPayload(balance.result_json),
    source: "saved",
    config: balance.config_json as BalancerConfig | null
  };
}

export function convertBalanceResponseToInternalPayload(
  response: BalanceResponse
): InternalBalancePayload {
  return normalizeInternalPayload({
    teams: response.teams.map((team) => ({
      id: team.id,
      name: team.name,
      average_mmr: team.average_mmr,
      rating_variance: team.rating_variance,
      total_discomfort: team.total_discomfort,
      max_discomfort: team.max_discomfort,
      format_violations: team.format_violations ?? [],
      format_advisories: team.format_advisories ?? [],
      roster: team.roster
    })),
    statistics: response.statistics,
    benched_players: response.benched_players ?? []
  });
}

function getRegistrationDisplayName(registration: AdminRegistration): string {
  return registration.primary_handle ?? registration.display_name ?? `registration-${registration.id}`;
}

/**
 * Every handle the registration carries for the owner game's identity provider: the primary handle first, the extra
 * accounts after, deduplicated case-insensitively. `fallback` stands in when the registration answered no handle of
 * that provider (or the game has none).
 */
export function getRegistrationHandles(
  registration: Pick<AdminRegistration, "answers">,
  provider: string | null,
  fallback: string
): string[] {
  const handles = provider ? answerList(registration.answers, identityKey(provider)) : [];
  const seen = new Set<string>();
  return [handles[0] ?? fallback, ...handles.slice(1)]
    .map((handle) => handle?.trim())
    .filter((handle): handle is string => Boolean(handle))
    .filter((handle) => {
      const key = handle.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

/** The identity fields of the synthetic records, read for the owner game's provider (`null`: the game has none). */
function registrationIdentityFields(registration: AdminRegistration, provider: string | null) {
  const fallback = getRegistrationDisplayName(registration);
  const [identity = fallback, ...additional_handles] = getRegistrationHandles(registration, provider, fallback);
  return { identity, identity_key: normalizeSocialHandle(provider ?? "", identity), additional_handles };
}

export function isRegistrationIncludedInBalancer(registration: AdminRegistration): boolean {
  return !registration.deleted_at && !registration.balancer_status_meta.excludes_from_balancer;
}

/** Whether the registration's current custom status blocks it from counting as "ready", independent of pool inclusion. */
function isRegistrationReadyBlocked(registration: AdminRegistration): boolean {
  return registration.balancer_status_meta.excludes_from_ready;
}

export function isRegistrationAvailableForBalancer(registration: AdminRegistration): boolean {
  return registration.status === "approved" && !registration.deleted_at;
}

export function createSyntheticPlayerFromRegistration(
  registration: AdminRegistration,
  grid: DivisionGrid,
  /** The owner game's identity provider: whose handle answers name the player. */
  identityProvider: string | null
): BalancerPlayerRecord {
  const isFlex = registration.is_flex;
  return {
    id: registration.id,
    tournament_id: registration.tournament_id,
    application_id: registration.id,
    ...registrationIdentityFields(registration, identityProvider),
    user_id: registration.user_id,
    // Roles come from the API exactly as the roster engine resolved them:
    // `is_active` IS "playable" and `rank_value` IS the resolved rank, flex
    // modes included. Nothing is re-derived here.
    role_entries_json: registration.roles.map((role) => ({
      role: roleOf(role.role) as BalancerRoleCode,
      subtype: subRoleSlugOf(role.role),
      priority: role.priority,
      division_number: resolveDivisionFromRank(grid, role.rank_value),
      rank_value: role.rank_value,
      is_active: role.is_active,
      is_declared_active: role.is_declared_active,
      ow_rank_value: role.ow_rank_value ?? null,
      rank_source: role.rank_source
    })),
    is_flex: isFlex,
    is_in_pool: isRegistrationIncludedInBalancer(registration),
    ready_blocked: isRegistrationReadyBlocked(registration),
    admin_notes: registration.admin_notes
  };
}

export function createSyntheticApplicationFromRegistration(
  registration: AdminRegistration,
  player: BalancerPlayerRecord | null,
  identityProvider: string | null
): BalancerApplication {
  const sortedRoles = [...registration.roles].sort((left, right) => left.priority - right.priority);
  const isFlex = registration.is_flex;
  const primaryRole = isFlex
    ? null
    : roleOf(sortedRoles.find((role) => role.is_primary)?.role ?? sortedRoles[0]?.role);
  const additionalRoles = sortedRoles
    .map((role) => roleOf(role.role))
    .filter((role) => isFlex || role !== primaryRole);

  return {
    id: registration.id,
    tournament_id: registration.tournament_id,
    tournament_sheet_id: 0,
    ...registrationIdentityFields(registration, identityProvider),
    twitch_nick: answerList(registration.answers, "identity_twitch")[0] ?? null,
    discord_nick: answerList(registration.answers, "identity_discord")[0] ?? null,
    stream_pov: answerFlag(registration.answers, "stream_pov"),
    last_tournament_text: null,
    primary_role: primaryRole,
    additional_roles_json: additionalRoles,
    notes: answerText(registration.answers, "public_notes"),
    submitted_at: registration.submitted_at,
    synced_at: registration.submitted_at ?? registration.reviewed_at ?? new Date(0).toISOString(),
    is_active: isRegistrationAvailableForBalancer(registration),
    player
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

export function downloadPlayersExport(
  payload: BalancerPlayerExportResponse,
  tournamentId: number | null
) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  // The two formats are not interchangeable, so the file says which one it is:
  // `xv-1` keeps its historical name, ours is prefixed by the format.
  anchor.download =
    payload.format === "owt-1"
      ? `owt-players-${tournamentId ?? "export"}.json`
      : `balancer-players-${tournamentId ?? "export"}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}

/**
 * Looks up a player's rank history using a two-step search:
 * 1. Balancer history — ranks from past balancer registrations (source "balancer"),
 *    scoped to `workspaceId` when numeric, otherwise `currentWorkspaceId`.
 * 2. Analytics fallback — past tournament ranks via getUserTournaments (source "analytics")
 *    for roles not found in step 1.
 *
 * Division numbers are normalized to the target grid version when provided. Returns null if
 * the user cannot be found or has no history.
 */
export async function fetchPlayerRankHistoryPreview(
  identity: string,
  targetGridVersion: DivisionGridVersion | null,
  grid: DivisionGrid,
  workspaceId: number | null | undefined,
  currentWorkspaceId: number | null | undefined,
  /** The game the preview is for: tournaments of any other game are never read as this game's ranks. */
  discipline: string,
  /** The game's selectable role codes in declared order: the roles a history can seed, listed in this order. */
  roleCodes: readonly BalancerRoleCode[]
): Promise<PlayerRankHistoryPreview | null> {
  try {
    const lookupName = identity.replace("#", "-");
    const user = await userService.getUserByName(lookupName);
    if (!user?.id) return null;

    const latestPerRole = new Map<BalancerRoleCode, PlayerRankHistoryPreviewEntry>();

    // Step 1: Balancer history — ranks from past balancer registrations (newest first).
    // Scoped to a concrete workspace (the chosen one, else the current workspace).
    const balancerWorkspaceId =
      typeof workspaceId === "number" ? workspaceId : currentWorkspaceId ?? null;
    if (balancerWorkspaceId != null) {
      try {
        const balancerHistory = await balancerAdminService.getUserBalancerRankHistory(
          user.id,
          balancerWorkspaceId
        );
        for (const entry of balancerHistory) {
          const code = normalizeApplicationRole(roleOf(entry.role));
          if (!code || latestPerRole.has(code)) continue; // newest already kept
          latestPerRole.set(code, {
            role: code,
            rank_value: entry.rank_value,
            division_number: resolveDivisionFromRank(grid, entry.rank_value),
            original_division_number: null,
            tournament_id: entry.tournament_id,
            tournament_name: entry.tournament_name,
            source_role: null,
            tournament_grid_version: null,
            source: "balancer"
          });
        }
      } catch {
        // Non-fatal: fall through to the analytics step.
      }
    }

    // Step 2: Analytics fallback — past tournament ranks for roles not found in step 1,
    // most recent tournaments first.
    const missingRoles = roleCodes.filter((role) => !latestPerRole.has(role));
    if (missingRoles.length > 0) {
      const tournaments = await userService.getUserTournaments(user.id, workspaceId);
      if (tournaments?.length) {
        const sorted = [...tournaments]
          .filter((tournament) => tournament.discipline === discipline)
          .sort((a, b) => b.id - a.id);

        const sourceVersionsById = new Map<number, DivisionGridVersion>();
        for (const tournament of sorted) {
          const v = tournament.division_grid_version;
          if (v) sourceVersionsById.set(v.id, { ...v, discipline: tournament.discipline });
        }

        let normalizer: DivisionGridNormalizer | null = null;
        if (targetGridVersion) {
          normalizer = await DivisionGridNormalizer.build(
            { ...targetGridVersion, discipline },
            [...sourceVersionsById.values()]
          );
        }

        for (const tournament of sorted) {
          // A flex participation (or none) carries ONE rank that stands for no particular role (the player's
          // maximum), so attributing it to a role would invent per-role history the tournament never recorded —
          // the same call the backend makes in `registration/rank_sources.py::canonical_to_registration_role`.
          const roleCode = tournament.role ? normalizeApplicationRole(roleOf(tournament.role)) : null;
          if (!roleCode) continue;
          if (latestPerRole.has(roleCode)) continue;
          const playerRecord = tournament.players.find((p) => p.user_id === user.id);
          const rankValue = playerRecord?.rank ?? null;
          if (rankValue !== null && rankValue > 0) {
            const originalDivisionNumber = resolveDivisionFromRank(
              tournament.division_grid_version ?? grid,
              rankValue
            );

            let divisionNumber: number | null;
            if (normalizer && tournament.division_grid_version) {
              divisionNumber = normalizer.safeNormalize(tournament.division_grid_version.id, rankValue);
            } else {
              divisionNumber = originalDivisionNumber;
            }

            latestPerRole.set(roleCode, {
              role: roleCode,
              rank_value: rankValue,
              division_number: divisionNumber,
              original_division_number: originalDivisionNumber,
              tournament_id: tournament.id,
              tournament_name: tournament.name,
              source_role: roleCode,
              tournament_grid_version: tournament.division_grid_version ?? null,
              source: "analytics"
            });
          }
        }
      }
    }

    const entries = roleCodes
      .map((role) => latestPerRole.get(role))
      .filter((entry): entry is PlayerRankHistoryPreviewEntry => entry !== undefined);
    if (entries.length === 0) {
      return null;
    }

    const average_rank_value = Math.round(
      entries.reduce((sum, entry) => sum + entry.rank_value, 0) / entries.length
    );

    return {
      user_id: user.id,
      entries,
      average_rank_value
    };
  } catch {
    return null;
  }
}
