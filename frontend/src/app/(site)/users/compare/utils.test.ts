import { describe, expect, it } from "vitest";

import { LOL_METADATA, OW_METADATA } from "@/test/discipline-metadata";

import { compareRoleFilter } from "./utils";

describe("compare role filter", () => {
  it("filters on one of the browsed game's rated roles, in that game's dimension", () => {
    expect(compareRoleFilter(OW_METADATA, "support")).toEqual({ dimension: "player_role", role: "support" });
    expect(compareRoleFilter(LOL_METADATA, "jungle")).toEqual({ dimension: "position", role: "jungle" });
  });

  it("never filters on the open slot, another game's role, or before the game is known", () => {
    expect(compareRoleFilter(OW_METADATA, "flex")).toBeUndefined();
    expect(compareRoleFilter(OW_METADATA, "jungle")).toBeUndefined();
    expect(compareRoleFilter(OW_METADATA, "Support")).toBeUndefined();
    expect(compareRoleFilter(null, "support")).toBeUndefined();
    expect(compareRoleFilter(OW_METADATA, undefined)).toBeUndefined();
  });
});
