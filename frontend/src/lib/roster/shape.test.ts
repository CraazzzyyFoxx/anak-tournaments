import { describe, expect, it } from "vitest";

import { isRoleSlotCode, orderSlotCodes } from "./shape";

describe("orderSlotCodes", () => {
  it("returns the canonical order regardless of key order", () => {
    expect(orderSlotCodes({ support: 2, flex: 1, damage: 2, tank: 1 })).toEqual([
      "tank",
      "damage",
      "support",
      "flex"
    ]);
  });

  it("omits codes that are absent or zeroed", () => {
    expect(orderSlotCodes({ tank: 1, damage: 0, flex: 5 })).toEqual(["tank", "flex"]);
    expect(orderSlotCodes({})).toEqual([]);
  });
});

describe("isRoleSlotCode", () => {
  it("treats flex as the only role-free slot", () => {
    expect(isRoleSlotCode("flex")).toBe(false);
    expect(isRoleSlotCode("tank")).toBe(true);
  });
});
