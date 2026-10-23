import { describe, expect, it } from "vitest";

import { aggregateFacts, selectFacts, type Observation } from "./facts";

const fact = (segment: number, entity_id: number | null, value: number) => ({
  encounter_team_id: 1,
  workspace_member_id: 7,
  entity_id,
  segment,
  stat_code: "kills",
  value
});

describe("selectFacts", () => {
  const facts = [
    fact(0, null, 10),
    fact(1, null, 4),
    fact(0, 5, 6),
    fact(1, 5, 4),
    fact(2, null, 6)
  ];

  it("returns exactly one grain: whole match, no entity", () => {
    expect(selectFacts(facts, { segment: 0, entity: "none" }).map((f) => f.value)).toEqual([10]);
  });

  it("keeps the same segment's per-entity rows and other segments apart", () => {
    expect(selectFacts(facts, { segment: 0, entity: 5 }).map((f) => f.value)).toEqual([6]);
    expect(selectFacts(facts, { segment: 1, entity: "none" }).map((f) => f.value)).toEqual([4]);
    expect(selectFacts(facts, { segment: 3, entity: "none" })).toEqual([]);
  });
});

describe("aggregateFacts", () => {
  const obs = (value: number, at: string, matchId: number): Observation => ({ value, at, matchId });
  const series = [
    obs(5, "2026-01-02T00:00:00Z", 2),
    obs(9, "2026-01-01T00:00:00Z", 1),
    obs(1, "2026-01-03T00:00:00Z", 3)
  ];

  it("applies each declared rule", () => {
    expect(aggregateFacts(series, "sum")).toBe(15);
    expect(aggregateFacts(series, "avg")).toBe(5);
    expect(aggregateFacts(series, "max")).toBe(9);
    expect(aggregateFacts(series, "min")).toBe(1);
  });

  it("takes `last` from (at, matchId), not array order", () => {
    expect(aggregateFacts(series, "last")).toBe(1);
    const tied = [obs(3, "2026-01-01T00:00:00Z", 8), obs(4, "2026-01-01T00:00:00Z", 2)];
    expect(aggregateFacts(tied, "last")).toBe(3);
  });

  it("treats nothing observed as missing, not zero", () => {
    for (const rule of ["sum", "avg", "max", "min", "last"] as const) {
      expect(aggregateFacts([], rule)).toBeNull();
      expect(aggregateFacts([obs(Number.NaN, "2026-01-01T00:00:00Z", 1)], rule)).toBeNull();
    }
    expect(aggregateFacts([obs(0, "2026-01-01T00:00:00Z", 1)], "sum")).toBe(0);
  });
});
