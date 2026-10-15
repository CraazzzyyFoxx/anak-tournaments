import { describe, expect, it } from "vitest";

import { roleOf, subRoleOf, toRoleRef } from "@/lib/roster/role-ref";

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
});
