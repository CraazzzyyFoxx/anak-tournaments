import { describe, expect, it } from "vitest";

import type { RankOverviewRow } from "@/services/workspace-player.service";

import { groupPastRanks, pivotCurrentRanks } from "./personRanks.model";

const ROLES = ["tank", "damage", "support"];

function row(overrides: Partial<RankOverviewRow>): RankOverviewRow {
  return {
    layer: "canon",
    discipline: "overwatch",
    player_id: 599,
    member_id: 1,
    display_name: null,
    identity: null,
    author_user_id: null,
    author_name: null,
    role: "tank",
    rank_value: 3000,
    division: null,
    source: null,
    sigma: null,
    delta: null,
    canon_diff: null,
    native_division: null,
    native_tier: null,
    context: null,
    at: null,
    ...overrides
  };
}

describe("person ranks model", () => {
  it("pivots layers × roles, fills an author's open role from their mix book and drops empty layers and roles", () => {
    const matrix = pivotCurrentRanks(
      [
        row({ layer: "author", role: "support", author_user_id: 7, author_name: "Тхао", rank_value: 3600 }),
        row({ layer: "canon", role: "damage", rank_value: 3500 }),
        row({ layer: "effective_tournament", role: "damage", source: "workspace" }),
        row({ layer: "author", role: "damage", author_user_id: 7, author_name: "Тхао", rank_value: 3700 }),
        // Shadowed by the author's own damage number; fills support only for an author who has none there.
        row({ layer: "effective_mix", role: "damage", author_user_id: 7, rank_value: 1 }),
        row({ layer: "author", role: "damage", author_user_id: 8, author_name: "Alice", rank_value: 3400 }),
        row({ layer: "effective_mix", role: "support", author_user_id: 8, source: "author", rank_value: 3450 })
      ],
      ROLES
    );

    expect(matrix.roles).toEqual(["damage", "support"]);
    expect(matrix.layers.map((line) => line.layer)).toEqual(["effective_tournament", "canon"]);
    expect(matrix.layers[0].source).toBe("workspace");
    expect(matrix.authors.map((line) => line.label)).toEqual(["Alice", "Тхао"]);

    const [alice, thao] = matrix.authors;
    expect(alice.cells.get("damage")).toMatchObject({ mix: false, row: { rank_value: 3400 } });
    expect(alice.cells.get("support")).toMatchObject({ mix: true, row: { rank_value: 3450 } });
    expect(thao.cells.get("damage")).toMatchObject({ mix: false, row: { rank_value: 3700 } });
  });

  it("keeps a role-less game as one column and leaves a mixed source to the cells", () => {
    const matrix = pivotCurrentRanks(
      [
        row({ layer: "native", role: null, native_division: "ascendant", native_tier: 1 }),
        row({ layer: "effective_tournament", role: null, source: "native" }),
        row({ layer: "effective_tournament", role: "tank", source: "workspace" })
      ],
      []
    );

    expect(matrix.roles).toEqual(["tank", null]);
    expect(matrix.layers.map((line) => line.layer)).toEqual(["effective_tournament", "native"]);
    expect(matrix.layers[0].source).toBeNull();
    expect(matrix.authors).toEqual([]);
  });

  it("groups the history by tournament or mix, newest first, with each mix role's run in time order", () => {
    const cup = { kind: "tournament" as const, id: 10, label: "Cup", team: null, lobby_index: null };
    const mix = { kind: "mix" as const, id: 20, label: "Mix #20", team: null, lobby_index: null };
    const groups = groupPastRanks(
      [
        row({ layer: "registration", role: "support", context: cup, at: "2026-01-01T10:00:00Z" }),
        row({ layer: "casual", role: "tank", context: mix, at: "2026-03-02T10:00:00Z", rank_value: 4150, author_name: "Тхао" }),
        row({ layer: "registration", role: "tank", context: cup, at: "2026-01-01T09:00:00Z" }),
        row({ layer: "casual", role: "tank", context: mix, at: "2026-03-01T10:00:00Z", rank_value: 4200, delta: -50 }),
        row({ layer: "tournament", role: null, context: cup, at: "2026-01-05T10:00:00Z" })
      ],
      ROLES
    );

    expect(groups.map((group) => group.key)).toEqual(["mix:20", "tournament:10"]);
    const [mixGroup, cupGroup] = groups;
    expect(mixGroup.owner).toBe("Тхао");
    expect(mixGroup.casual.map((run) => run.map((entry) => entry.rank_value))).toEqual([[4200, 4150]]);
    expect(cupGroup.owner).toBeNull();
    expect(cupGroup.registration.map((entry) => entry.role)).toEqual(["tank", "support"]);
    expect(cupGroup.tournament).toHaveLength(1);
    expect([cupGroup.first, cupGroup.last]).toEqual(["2026-01-01T09:00:00Z", "2026-01-05T10:00:00Z"]);
  });
});
