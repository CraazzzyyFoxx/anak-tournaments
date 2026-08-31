import { describe, expect, it } from "vitest";

import { standardOwTierPayload } from "./page";
import { DEFAULT_DIVISION_GRID } from "@/lib/division-grid";
import { OW2_RANK_OPTIONS } from "@/lib/ow-rank-mapping";

describe("standard OW grid payload", () => {
  it("carries the whole ladder with no tier ids, so the save spawns a new version", () => {
    const tiers = standardOwTierPayload();

    expect(tiers).toHaveLength(DEFAULT_DIVISION_GRID.tiers.length);
    // No ids -> _classify_tier_change reads the save as structural and versions
    // it instead of rewriting the active version in place.
    expect(tiers.every((tier) => tier.id === undefined)).toBe(true);
    expect(tiers.map((tier) => tier.sort_order)).toEqual(tiers.map((_, index) => index));
  });

  it("fills the OW mapping on both ends of every tier, top tier included", () => {
    const tiers = standardOwTierPayload();

    // A tier with either endpoint null is skipped by
    // resolve_division_from_ow_rank, and once any tier is configured the
    // unconfigured ones become unreachable — so a null here would silently drop
    // Champion 1 (the open-ended `rank_max` tier) out of OW rank resolution.
    expect(tiers.every((tier) => tier.ow_rank_min !== null && tier.ow_rank_max !== null)).toBe(
      true
    );

    // One OW rank per tier, matching what "Auto-map OW ranges" produces for a
    // 45-tier grid: the ladder's rank_min IS the tier's OW rank_value.
    const owRanks = new Set(OW2_RANK_OPTIONS.map((option) => option.value));
    expect(tiers.every((tier) => tier.ow_rank_min === tier.ow_rank_max)).toBe(true);
    expect(tiers.every((tier) => owRanks.has(tier.ow_rank_min!))).toBe(true);
    expect(new Set(tiers.map((tier) => tier.ow_rank_min)).size).toBe(tiers.length);
  });
});
