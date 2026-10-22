import { describe, expect, it } from "vitest";

import type { PickBanRulesCatalog } from "@/types/tournament.types";

import { mixBanPresetIds } from "./useHeroBanPresets";

const preset = (id: string, kind: "hero" | "map", mixEligible: boolean) => ({
  id,
  kind,
  modes: ["pool"],
  first_ban_rotation: null,
  ruleset: { version: 2, timer_seconds: null, on_timeout: "random_fill", phases: [] },
  mix_eligible: mixEligible,
});

describe("mixBanPresetIds", () => {
  it("offers exactly the presets the server marks playable in a mix, in catalog order", () => {
    const catalog = {
      leaves: [],
      constraints: [],
      groups: { hero: [], map: [] },
      presets: [
        preset("hero_classic", "hero", true),
        preset("hero_targeted", "hero", false),
        preset("hero_anti_one_trick", "hero", true),
        preset("map_bracket", "map", false),
      ],
    } as unknown as PickBanRulesCatalog;

    expect(mixBanPresetIds(catalog)).toEqual(["hero_classic", "hero_anti_one_trick"]);
  });

  it("offers nothing before the catalog loads", () => {
    expect(mixBanPresetIds(undefined)).toEqual([]);
  });
});
