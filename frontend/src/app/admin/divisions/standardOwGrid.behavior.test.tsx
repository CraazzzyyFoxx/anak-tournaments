import { describe, expect, it } from "vitest";

import { buildEditorState } from "./page";
import { DEFAULT_DIVISION_GRID } from "@/lib/division-grid";

describe("standard OW grid load", () => {
  it("loads the full OW ladder with no tier ids, so the save spawns a new version", () => {
    const { tiers } = buildEditorState(null);

    expect(tiers).toHaveLength(DEFAULT_DIVISION_GRID.tiers.length);
    // No ids -> the backend classifies the save as structural (see
    // _classify_tier_change) and versions it instead of editing in place.
    expect(tiers.every((tier) => tier.id === undefined)).toBe(true);
    expect(tiers.map((tier) => tier.number)).toEqual(
      [...DEFAULT_DIVISION_GRID.tiers].map((tier) => tier.number).sort((a, b) => a - b)
    );
    expect(tiers.map((tier) => tier.sort_order)).toEqual(tiers.map((_, index) => index));
  });
});
