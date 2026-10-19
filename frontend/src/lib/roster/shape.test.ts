import { describe, expect, it } from "vitest";

import { isRoleSlot, slotCodesOf } from "./shape";

describe("slotCodesOf", () => {
  it("keeps the server's order for any game's codes", () => {
    expect(slotCodesOf({ top: 1, jungle: 1, mid: 1, bot: 1, support: 1 })).toEqual([
      "top",
      "jungle",
      "mid",
      "bot",
      "support"
    ]);
    expect(slotCodesOf({ tank: 1, damage: 2, support: 2, flex: 1 })).toEqual([
      "tank",
      "damage",
      "support",
      "flex"
    ]);
  });

  it("omits codes that are absent or zeroed", () => {
    expect(slotCodesOf({ tank: 1, damage: 0, flex: 5 })).toEqual(["tank", "flex"]);
    expect(slotCodesOf({})).toEqual([]);
  });
});

describe("isRoleSlot", () => {
  it("treats flex as the only role-free slot", () => {
    expect(isRoleSlot("flex")).toBe(false);
    expect(isRoleSlot("tank")).toBe(true);
    expect(isRoleSlot("jungle")).toBe(true);
  });
});
