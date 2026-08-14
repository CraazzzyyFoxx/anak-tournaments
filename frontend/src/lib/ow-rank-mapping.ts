import type { RankMappingEntry } from "@/types/admin.types";

export interface OW2RankOption {
  label: string;
  value: number;
}

/**
 * Identity of the backend's built-in division+tier -> rank_value table
 * (`DEFAULT_RANK_MAPPING_VERSION` in `shared/schemas/settings.py`). Bumped
 * whenever that table is rebased — a bare `rank_value` is ambiguous across
 * versions (2500 was Platinum 5 under v1, Emerald 5 under v2).
 */
export const DEFAULT_RANK_MAPPING_VERSION = "ow2-default-v2";

export const OW2_DIVISIONS_DESC = [
  "ultimate",
  "grandmaster",
  "master",
  "diamond",
  "emerald",
  "platinum",
  "gold",
  "silver",
  "bronze"
] as const;

// Mirrors the backend default table (DEFAULT_OW2_DIVISION_BASE, mapping version
// ow2-default-v2): nine 500-wide divisions anchored at Bronze 5 = 500. Emerald
// took the 2500 band platinum used to hold, so diamond and above are unchanged.
const DIVISION_BASE: Record<string, number> = {
  bronze: 500,
  silver: 1000,
  gold: 1500,
  platinum: 2000,
  emerald: 2500,
  diamond: 3000,
  master: 3500,
  grandmaster: 4000,
  ultimate: 4500
};

export function defaultRankForCell(division: string, tier: number): number {
  return (DIVISION_BASE[division] ?? 0) + (5 - tier) * 100;
}

/** All OW2 ranks as Select options, sorted highest → lowest (Ultimate 1 … Bronze 5). */
export const OW2_RANK_OPTIONS: OW2RankOption[] = OW2_DIVISIONS_DESC.flatMap((division) =>
  [1, 2, 3, 4, 5].map((tier) => ({
    label: `${division.charAt(0).toUpperCase()}${division.slice(1)} ${tier}`,
    value: defaultRankForCell(division, tier),
  }))
);

export function buildMappingCells(stored: RankMappingEntry[]): RankMappingEntry[] {
  const byKey = new Map(stored.map((e) => [`${e.division.toLowerCase()}-${e.tier}`, e]));
  const cells: RankMappingEntry[] = [];
  for (const division of OW2_DIVISIONS_DESC) {
    for (let tier = 1; tier <= 5; tier++) {
      const existing = byKey.get(`${division}-${tier}`);
      cells.push({
        division,
        tier,
        rank_value: existing?.rank_value ?? defaultRankForCell(division, tier)
      });
    }
  }
  return cells;
}
