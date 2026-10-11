import type { ROLE_LABEL_KEY } from "@/app/(site)/users/components/shared/list-utils";
import type { UserOverviewRoleDivision, UserRoleType } from "@/types/user.types";
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

// The `Flex` chip filters on `role=Flex` — players whose declared roster role is
// literally flex — and its count is `stats.flex_declared_count`, the same
// predicate. `stats.flex_count` counts a strictly wider population ("plays
// anything": multi-role OR explicit flex) and is not shown beside this chip.
export const ROLE_FILTERS: Array<{
  value: "all" | UserRoleType;
  labelKey: "common.all" | (typeof ROLE_LABEL_KEY)[UserRoleType];
}> = [
  { value: "all", labelKey: "common.all" },
  { value: "Tank", labelKey: "common.roles.tank" },
  { value: "Damage", labelKey: "common.roles.damage" },
  { value: "Support", labelKey: "common.roles.support" },
  { value: "Flex", labelKey: "common.roles.flex" }
];

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

/** Splits `Player#1234` into the handle and its BattleTag discriminator. */
export function splitTag(name: string): { handle: string; tag: string | null } {
  const idx = name.lastIndexOf("#");
  if (idx === -1) {
    return { handle: name, tag: null };
  }
  return { handle: name.slice(0, idx), tag: name.slice(idx) };
}

/**
 * The grid version a row's division number belongs to, from the grids the
 * response shipped alongside the rows. `null` means "fall back to the
 * workspace grid" — the only possibility before the backend sends ids.
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
