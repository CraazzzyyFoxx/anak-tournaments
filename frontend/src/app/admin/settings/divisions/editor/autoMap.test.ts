// What "AUTO · 67%" and "SPLIT · choose" actually mean, and why only the second
// stops a publish. An old division becomes the new one holding most of its
// ranks; the mapping is only ambiguous where the old band was cut and no new
// band holds a majority. Getting that rule wrong either buries the user in
// decisions they do not need to make, or silently sends a tournament's players
// into the wrong division.
import { describe, expect, it } from "vitest";

import type { DivisionTier } from "@/types/workspace.types";

import { autoMap, mappingRules, primaryTarget, unresolvedRows } from "./autoMap";
import { LADDER, RANK_COUNT, type Band } from "./draftReducer";

function target(id: number, name: string, owFrom: number, owTo: number): Band {
  return { id, slug: name.toLowerCase(), name, number: id, icon_url: null, owFrom, owTo };
}

/** A stored source tier spanning ladder indices `from … to`. */
function source(id: number, name: string, from: number, to: number): DivisionTier {
  return {
    id,
    slug: name.toLowerCase(),
    number: id,
    name,
    rank_min: LADDER[to].rank_min,
    rank_max: LADDER[from].rank_max,
    sort_order: id - 1,
    icon_url: "https://cdn/x.png"
  };
}

describe("autoMap", () => {
  it("maps a whole source band onto its container at full coverage", () => {
    const rows = autoMap([source(1, "Old", 0, 2), source(2, "Rest", 3, RANK_COUNT - 1)], [
      target(10, "Champion", 0, 2),
      target(11, "Field", 3, RANK_COUNT - 1)
    ]);

    expect(rows[0].kind).toBe("auto");
    expect(rows[0].coverage).toBe(1);
    expect(rows[0].candidates.map((candidate) => candidate.band.id)).toEqual([10]);
    expect(primaryTarget(rows[0], {})?.id).toBe(10);
  });

  it("still resolves automatically when one target holds the majority", () => {
    // Source spans three ranks; the new grid cut it 2 / 1 -> 67 %, no decision.
    const rows = autoMap([source(1, "Old", 0, 2), source(2, "Rest", 3, RANK_COUNT - 1)], [
      target(10, "Contender", 0, 1),
      target(11, "Field", 2, RANK_COUNT - 1)
    ]);

    expect(rows[0].kind).toBe("auto");
    expect(Math.round(rows[0].coverage * 100)).toBe(67);
    expect(rows[0].candidates.map((candidate) => candidate.overlap)).toEqual([2, 1]);
    expect(primaryTarget(rows[0], {})?.id).toBe(10);
  });

  it("asks for a decision only when the leading candidates tie", () => {
    // Two ranks, one each: neither new division owns the old one's players.
    const rows = autoMap([source(1, "Old", 0, 1), source(2, "Rest", 2, RANK_COUNT - 1)], [
      target(10, "Upper", 0, 0),
      target(11, "Lower", 1, 1),
      target(12, "Field", 2, RANK_COUNT - 1)
    ]);

    expect(rows[0].kind).toBe("split");
    expect(primaryTarget(rows[0], {})).toBeNull();
    expect(unresolvedRows(rows, {})).toHaveLength(1);

    expect(primaryTarget(rows[0], { 1: 11 })?.id).toBe(11);
    expect(unresolvedRows(rows, { 1: 11 })).toHaveLength(0);
  });

  it("writes one rule per overlap, weighted, with exactly one primary", () => {
    const rows = autoMap([source(1, "Old", 0, 1), source(2, "Rest", 2, RANK_COUNT - 1)], [
      target(10, "Upper", 0, 0),
      target(11, "Lower", 1, 1),
      target(12, "Field", 2, RANK_COUNT - 1)
    ]);

    // Unresolved: the split row contributes nothing, which is what keeps the
    // mapping incomplete server-side instead of guessing on the user's behalf.
    expect(mappingRules(rows, {}).map((rule) => rule.source_tier_id)).toEqual([2]);

    const rules = mappingRules(rows, { 1: 11 });
    const forOld = rules.filter((rule) => rule.source_tier_id === 1);
    expect(forOld).toHaveLength(2);
    expect(forOld.every((rule) => rule.weight === 0.5)).toBe(true);
    expect(forOld.filter((rule) => rule.is_primary).map((rule) => rule.target_tier_id)).toEqual([
      11
    ]);
  });

  it("skips a target band that has no id yet — an unsaved draft cannot be mapped", () => {
    const unsaved: Band = {
      slug: "fresh",
      name: "Untitled division",
      number: 1,
      icon_url: null,
      owFrom: 0,
      owTo: RANK_COUNT - 1
    };
    const rows = autoMap([source(1, "Old", 0, RANK_COUNT - 1)], [unsaved]);

    expect(rows[0].kind).toBe("auto");
    expect(mappingRules(rows, {})).toEqual([]);
  });
});
