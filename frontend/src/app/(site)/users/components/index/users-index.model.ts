import { ratedDimension, registrationRoles, type RoleOntology } from "@/lib/roster/ontology";
import type { RoleRef } from "@/lib/roster/role-ref";
import { OPEN_SLOT_CODE } from "@/lib/roster/shape";
import type { UserOverviewRoleDivision } from "@/types/user.types";
import type { DivisionGridVersion } from "@/types/workspace.types";

export type SortValue =
  | "name"
  | "tournaments_count"
  | "achievements_count"
  | "avg_placement"
  | "winrate"
  | "best_placement";
export type OrderValue = "asc" | "desc";
export type ViewMode = "table" | "catalog";

/** Sort values that read better largest-first, so a header's first click is `desc`. */
const DESC_FIRST: Partial<Record<SortValue, true>> = {
  tournaments_count: true,
  achievements_count: true,
  winrate: true
};

export const defaultOrderFor = (sort: SortValue): OrderValue =>
  DESC_FIRST[sort] ? "desc" : "asc";

export const PER_PAGE_OPTIONS = [20, 50, 100] as const;

/** Winrate sample floor offered in the toolbar popover. */
export const MIN_ENCOUNTERS_OPTIONS = [0, 10, 20, 50, 100] as const;
export const DEFAULT_MIN_ENCOUNTERS = 20;

// The role chips are the game's own rated roles plus the open slot (`role=flex`): players with no rated
// assignment, counted by `stats.flex_declared_count` — the same predicate. `stats.flex_count` counts a
// strictly wider population ("plays anything": multi-role OR open slot) and is not shown beside this chip.

/** A `?role=` value the game knows (one of its rated roles, or the open slot), else `undefined` (no filter). */
export function parseRoleChip(ontology: RoleOntology, value: string | null): string | undefined {
  if (value === OPEN_SLOT_CODE) return value;
  return registrationRoles(ontology).some((role) => role.code === value) ? (value as string) : undefined;
}

/** A role chip as the reads' filter: `null` = no rated assignment; `undefined` while the game's dimension is unknown. */
export function roleFilterOf(ontology: RoleOntology | null, chip: string | undefined): RoleRef | null | undefined {
  if (chip === undefined) return undefined;
  if (chip === OPEN_SLOT_CODE) return null;
  const rated = ontology ? ratedDimension(ontology) : null;
  return rated ? { dimension: rated.code, role: chip } : undefined;
}

export const ALPHABET = ["#", ..."ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("")];

const SORT_VALUES: SortValue[] = [
  "name",
  "tournaments_count",
  "achievements_count",
  "avg_placement",
  "winrate",
  "best_placement"
];

export const parseSort = (value: string | null): SortValue =>
  value && (SORT_VALUES as string[]).includes(value) ? (value as SortValue) : "tournaments_count";

export const parseOrder = (value: string | null, sort: SortValue): OrderValue => {
  if (value === "asc" || value === "desc") return value;
  return defaultOrderFor(sort);
};

export const parseView = (value: string | null): ViewMode =>
  value === "catalog" ? "catalog" : "table";

export const parsePerPage = (value: string | null): number => {
  const parsed = Number(value);
  return (PER_PAGE_OPTIONS as readonly number[]).includes(parsed) ? parsed : PER_PAGE_OPTIONS[0];
};

export const parseMinEncounters = (value: string | null): number => {
  // `Number(null)` and `Number("")` are 0, a valid option, so an absent param must short-circuit.
  if (!value) return DEFAULT_MIN_ENCOUNTERS;
  const parsed = Number(value);
  return (MIN_ENCOUNTERS_OPTIONS as readonly number[]).includes(parsed)
    ? parsed
    : DEFAULT_MIN_ENCOUNTERS;
};

/** `?div=3,5,7` → `[3, 5, 7]`, deduplicated and ascending. */
export const parseDivisions = (value: string | null): number[] => {
  if (!value) return [];
  const seen = new Set<number>();
  for (const part of value.split(",")) {
    const parsed = Number(part);
    if (Number.isInteger(parsed) && parsed > 0) seen.add(parsed);
  }
  return [...seen].sort((a, b) => a - b);
};

/**
 * The grid version a row's division number belongs to, from the grids the
 * response shipped alongside the rows. `null`: the number is on the read's own
 * grid (the workspace's; the game's native ladder across workspaces).
 */
export function gridForRole(
  role: UserOverviewRoleDivision,
  grids: DivisionGridVersion[] | undefined
): DivisionGridVersion | null {
  if (role.division_grid_version_id == null) return null;
  return grids?.find((grid) => grid.id === role.division_grid_version_id) ?? null;
}

/** Map winrate as a 0–100 percentage, or `null` when no map has a result. */
export function mapsWinratePct(row: { maps_won: number; maps_lost: number }): number | null {
  const decided = row.maps_won + row.maps_lost;
  if (decided <= 0) return null;
  return (row.maps_won / decided) * 100;
}

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

/** Did the player appear in a tournament within the last 30 days? */
export function isRecentlyActive(lastActiveAt: string | null, now: number = Date.now()): boolean {
  if (!lastActiveAt) return false;
  const time = new Date(lastActiveAt).getTime();
  return Number.isFinite(time) && now - time <= THIRTY_DAYS_MS;
}
