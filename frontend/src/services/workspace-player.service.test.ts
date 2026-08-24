import { describe, expect, it } from "bun:test";


import { parseRoleRanks } from "./workspace-player.service";

describe("parseRoleRanks", () => {
  it("keeps integer role ranks and skips blanks", () => {
    expect(parseRoleRanks({ tank: "2500", dps: "  ", support: "1800" })).toEqual({
      tank: 2500,
      support: 1800,
    });
  });

  it("rejects a non-integer rank", () => {
    expect(() => parseRoleRanks({ tank: "12.5", dps: "", support: "" })).toThrow(/tank/);
  });
});
