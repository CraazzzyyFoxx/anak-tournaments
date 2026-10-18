import { beforeEach, describe, expect, it, vi } from "vitest";

import type { DivisionGridVersion, DivisionTier } from "@/types/workspace.types";

const getDivisionGridMapping = vi.fn();
vi.mock("@/services/workspace.service", () => ({
  default: { getDivisionGridMapping: (...args: unknown[]) => getDivisionGridMapping(...args) }
}));

import { DivisionGridNormalizer } from "./grid-normalizer";

function tier(id: number, number: number, rank_min: number, rank_max: number | null): DivisionTier {
  return { id, number, name: `T${number}`, slug: `t${number}`, rank_min, rank_max, icon_url: "/x.png" };
}

function version(id: number, discipline: string | undefined, tiers: DivisionTier[]): DivisionGridVersion {
  return {
    id,
    grid_id: id,
    discipline,
    version: 1,
    label: `v${id}`,
    status: "published",
    created_from_version_id: null,
    published_at: null,
    tiers
  };
}

const TARGET = version(1, "overwatch", [tier(11, 1, 1000, null), tier(12, 2, 0, 999)]);

beforeEach(() => getDivisionGridMapping.mockReset());

describe("DivisionGridNormalizer.build · games", () => {
  it("never translates a version of another game and never asks for its mapping", async () => {
    const lol = version(2, "lol", [tier(21, 1, 500, null), tier(22, 2, 0, 499)]);
    const normalizer = await DivisionGridNormalizer.build(TARGET, [lol]);

    expect(normalizer.accepts(2)).toBe(false);
    expect(getDivisionGridMapping).not.toHaveBeenCalled();
    // No fallback resolution through the target grid: a LoL rank has no division here.
    expect(() => normalizer.safeNormalize(2, 700)).toThrow(/another game/);
    expect(() => normalizer.normalize(2, 700)).toThrow(/another game/);
  });

  it("keeps translating versions of the target's game, and versions whose game is not known", async () => {
    getDivisionGridMapping.mockResolvedValue({
      rules: [{ source_tier_id: 31, target_tier_id: 12, is_primary: true }]
    });
    const sameGame = version(3, "overwatch", [tier(31, 1, 0, null)]);
    const unknown = version(4, undefined, [tier(41, 1, 0, null)]);
    const normalizer = await DivisionGridNormalizer.build(TARGET, [sameGame, unknown]);

    expect(normalizer.accepts(3)).toBe(true);
    expect(normalizer.accepts(4)).toBe(true);
    expect(normalizer.normalize(3, 50)).toBe(2);
    expect(getDivisionGridMapping).toHaveBeenCalledWith(3, 1);
  });
});
