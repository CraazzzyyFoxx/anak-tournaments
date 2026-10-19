import { describe, expect, it } from "vitest";

import { orderedRoleCodes } from "@/lib/roster/ontology";
import { LOL_METADATA, OW_METADATA } from "@/test/discipline-metadata";

describe("orderedRoleCodes", () => {
  it("orders a read's role codes by the game's declared order, unknown codes last and kept", () => {
    expect(orderedRoleCodes(OW_METADATA, ["support", "retired", "tank", "support"])).toEqual([
      "tank",
      "support",
      "retired"
    ]);
    expect(orderedRoleCodes(LOL_METADATA, ["support", "jungle", "top"])).toEqual(["top", "jungle", "support"]);
  });

  it("keeps the reported order without a dictionary", () => {
    expect(orderedRoleCodes(null, ["support", "tank"])).toEqual(["support", "tank"]);
  });
});
