import { describe, expect, it } from "vitest";

import type { DisciplineCapabilities } from "@/types/discipline.types";

import { NAV_GROUPS, navItemAvailable } from "./site-nav-groups";

const NONE: DisciplineCapabilities = {
  catalog_sync: false,
  native_rank_collection: false,
  native_ladder: false,
  achievement_conditions: false,
  analytics: false
};
const game = (analytics: boolean, enabled = true) => ({ enabled, capabilities: { ...NONE, analytics } });
const analytics = NAV_GROUPS.flatMap((group) => group.items).find((item) => item.key === "analytics")!;
const tournaments = NAV_GROUPS.flatMap((group) => group.items).find((item) => item.key === "tournaments")!;

describe("capability-bound nav entries", () => {
  it("offer analytics only while an enabled game of the viewed scope declares it", () => {
    expect(analytics.requires).toBe("analytics");
    expect(navItemAvailable(analytics, [game(false), game(true)])).toBe(true);
    // A League-only workspace has no analytics board to open.
    expect(navItemAvailable(analytics, [game(false)])).toBe(false);
    // A disabled game's capability does not count.
    expect(navItemAvailable(analytics, [game(true, false), game(false)])).toBe(false);
    expect(navItemAvailable(analytics, [])).toBe(false);
  });

  it("keep an entry while the games are unknown, and never gate entries without a requirement", () => {
    expect(navItemAvailable(analytics, undefined)).toBe(true);
    expect(navItemAvailable(tournaments, [game(false)])).toBe(true);
  });
});
