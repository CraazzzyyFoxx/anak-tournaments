import { describe, expect, it } from "vitest";

import { ROLE_FILTER_OPTIONS } from "./constants";
import { parseRole } from "./utils";

describe("compare role filters", () => {
  it("offers and parses assigned roles only, never the unassigned Flex bucket", () => {
    expect(ROLE_FILTER_OPTIONS.map(({ value }) => value)).toEqual(["Tank", "Damage", "Support"]);
    expect(parseRole("Flex")).toBeUndefined();
    expect(parseRole(null)).toBeUndefined();
    expect(parseRole("Support")).toBe("Support");
  });
});
