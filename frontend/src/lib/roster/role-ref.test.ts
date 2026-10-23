import { describe, expect, it } from "vitest";

import { aggregateRoleStats, roleOf, subRoleOf, subRoleSlugOf, toRoleRef } from "@/lib/roster/role-ref";

describe("role refs", () => {
  it("reads the top-level role and the sub-role off a leaf", () => {
    const leaf = { dimension: "player_role", role: "damage_hitscan", parent: "damage" };
    expect([roleOf(leaf), subRoleOf(leaf)]).toEqual(["damage", "damage_hitscan"]);
    expect([roleOf({ dimension: "player_role", role: "tank", parent: null }), subRoleOf(null)]).toEqual(["tank", null]);
  });

  it("builds the leaf a form sends", () => {
    expect(toRoleRef("damage", "damage_hitscan", "player_role")).toEqual({ dimension: "player_role", role: "damage_hitscan" });
    expect(toRoleRef("tank", null, "player_role")).toEqual({ dimension: "player_role", role: "tank" });
    expect(toRoleRef(null, null, "player_role")).toBeNull();
  });

  it("keeps form suffixes distinct from qualified leaves", () => {
    expect(subRoleSlugOf({ dimension: "player_role", role: "damage_hitscan", parent: "damage" })).toBe("hitscan");
    expect(subRoleSlugOf({ dimension: "player_role", role: "support_support_main", parent: "support" })).toBe("support_main");
    expect(subRoleSlugOf({ dimension: "player_role", role: "tank" })).toBeNull();
  });

  it("sums leaves by dimension and parent without merging games or inventing a Flex role", () => {
    const rows = [
      { role: { dimension: "player_role", role: "support_main", parent: "support" }, maps: 10, maps_won: 6, tournaments: 1 },
      { role: { dimension: "player_role", role: "support_flex", parent: "support" }, maps: 20, maps_won: 10, tournaments: 2 },
      { role: { dimension: "position", role: "support" }, maps: 9, maps_won: 8, tournaments: 1 },
      { role: null, maps: 3, maps_won: 1, tournaments: 1 },
      { role: null, maps: 2, maps_won: 1, tournaments: 1 }
    ];
    expect(aggregateRoleStats(rows)).toEqual([
      { role: { dimension: "player_role", role: "support" }, maps: 30, maps_won: 16, tournaments: 3 },
      { role: { dimension: "position", role: "support" }, maps: 9, maps_won: 8, tournaments: 1 },
      { role: null, maps: 5, maps_won: 2, tournaments: 2 }
    ]);
    expect(rows[0].maps).toBe(10);
    expect(rows[0].role?.role).toBe("support_main");
  });
});
