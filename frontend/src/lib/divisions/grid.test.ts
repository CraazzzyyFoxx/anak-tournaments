import { describe, expect, it } from "vitest";

import {
  activeGridVersionId,
  getDivisionIconSrc,
  getDivisionLabel,
  resolveDivisionFromRank,
  resolveOwnerGrid
} from "@/lib/divisions/grid";
import type { DivisionGridVersion, DivisionTier } from "@/types/workspace.types";

function tier(number: number, rank_min: number, icon_url: string): DivisionTier {
  return { number, name: `Tier ${number}`, slug: `tier-${number}`, rank_min, rank_max: null, icon_url };
}

function version(id: number, tiers: DivisionTier[]): DivisionGridVersion {
  return {
    id,
    grid_id: id,
    version: 1,
    label: `v${id}`,
    status: "published",
    created_from_version_id: null,
    published_at: null,
    tiers
  };
}

describe("getDivisionIconSrc", () => {
  it("has no crest when the grid has none: nothing is borrowed from another game", () => {
    expect(getDivisionIconSrc({ tiers: [] }, 1)).toBeNull();
    expect(getDivisionLabel({ tiers: [] }, null)).toBeNull();
    expect(resolveDivisionFromRank({ tiers: [] }, 1500)).toBeNull();
  });

  it("uses the grid's own icon_url when the division is on it", () => {
    expect(
      getDivisionIconSrc({ tiers: [tier(3, 0, "https://s3.example/x.png")] }, 3)
    ).toBe("https://s3.example/x.png");
  });
});

describe("resolveOwnerGrid / activeGridVersionId", () => {
  const overwatch = version(10, [tier(1, 0, "/ow.png")]);
  const lol = version(20, [tier(1, 0, "/lol.png")]);
  const workspace = {
    default_division_grid_versions: { lol: 20 },
    effective_division_grid_versions: { overwatch, lol }
  };

  it("reads exactly the requested discipline's entry, never another game's or the first value", () => {
    expect(resolveOwnerGrid(workspace, "lol")).toBe(lol);
    expect(resolveOwnerGrid(workspace, "overwatch")).toBe(overwatch);
    expect(resolveOwnerGrid(workspace, "valorant")).toBeNull();
    expect(resolveOwnerGrid(workspace, null)).toBeNull();
    expect(resolveOwnerGrid(workspace, "constructor")).toBeNull();
    expect(resolveOwnerGrid(null, "lol")).toBeNull();
  });

  it("distinguishes an explicit active choice from the effective system fallback", () => {
    expect(activeGridVersionId(workspace, "lol")).toBe(20);
    // OW has an effective (system) version but no explicit activation.
    expect(activeGridVersionId(workspace, "overwatch")).toBeNull();
    expect(activeGridVersionId(workspace, undefined)).toBeNull();
  });
});
