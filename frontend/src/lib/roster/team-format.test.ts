import { describe, expect, it } from "vitest";

import { slotsToTeamFormat } from "@/lib/roster/team-format";

describe("slotsToTeamFormat", () => {
  it("turns role slots into exact quotas on an enforced dimension", () => {
    expect(slotsToTeamFormat({ tank: 1, damage: 2, support: 2 }, "player_role")).toEqual({
      name: "Custom roster",
      preset_code: null,
      starter_min: 5,
      starter_max: 5,
      dimensions: [{ dimension: "player_role", mode: "enforced" }],
      rules: [
        { role: { dimension: "player_role", role: "tank" }, hard_min: 1, hard_max: 1 },
        { role: { dimension: "player_role", role: "damage" }, hard_min: 2, hard_max: 2 },
        { role: { dimension: "player_role", role: "support" }, hard_min: 2, hard_max: 2 }
      ]
    });
  });

  it("makes a role-less map an off dimension with open slots only", () => {
    const format = slotsToTeamFormat({ flex: 6, tank: 0 }, "player_role");
    expect([format.starter_max, format.dimensions[0].mode, format.rules]).toEqual([6, "off", []]);
  });
});
