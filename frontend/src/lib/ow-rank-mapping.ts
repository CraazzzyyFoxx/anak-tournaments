import { OW_DIVISIONS_DESC, TIER_NUMBERS, owRankValue } from "@/lib/ow-ladder";
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

/** The ladder's `rank_value` for a native division + tier; `0` if unknown. */
export function defaultRankForCell(division: string, tier: number): number {
  return owRankValue(division, tier) ?? 0;
}

const divisionLabel = (division: string) =>
  `${division.charAt(0).toUpperCase()}${division.slice(1)}`;

/** All OW2 ranks as Select options, sorted highest → lowest (Ultimate 1 … Bronze 5). */
export const OW2_RANK_OPTIONS: OW2RankOption[] = OW_DIVISIONS_DESC.flatMap((division) =>
  TIER_NUMBERS.map((tier) => ({
    label: `${divisionLabel(division)} ${tier}`,
    value: defaultRankForCell(division, tier),
  }))
);

export function buildMappingCells(stored: RankMappingEntry[]): RankMappingEntry[] {
  const byKey = new Map(stored.map((e) => [`${e.division.toLowerCase()}-${e.tier}`, e]));
  const cells: RankMappingEntry[] = [];
  for (const division of OW_DIVISIONS_DESC) {
    for (const tier of TIER_NUMBERS) {
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
