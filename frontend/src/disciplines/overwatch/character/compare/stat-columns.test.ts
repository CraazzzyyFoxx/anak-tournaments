import { describe, expect, it } from "vitest";

import { COL, getDefaultColumnKeys } from "./stat-columns";

describe("hero leaderboard default columns", () => {
  // The catalog sends `attrs.class` in lowercase; a capitalised lookup once gave tanks a column of zero healing.
  it("give each catalog class its own role columns", () => {
    const tank = getDefaultColumnKeys("tank");
    expect(tank).toEqual(expect.arrayContaining(["per10_damage_blocked", "per10_solo_kills"]));
    expect(tank).not.toContain("per10_healing");

    const damage = getDefaultColumnKeys("damage");
    expect(damage).toContain("kd");
    expect(damage).not.toContain("per10_healing");

    expect(getDefaultColumnKeys("support")).toContain("per10_healing");
  });
});

describe("hero leaderboard accuracy columns", () => {
  it("print the API's fraction as percent points", () => {
    expect(COL.avg_weapon_accuracy.formatValue(0.32)).toBe("32.0%");
    expect(COL.avg_crit_accuracy.formatValue(0.055)).toBe("5.5%");
  });
});
