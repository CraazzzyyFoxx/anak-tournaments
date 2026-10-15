import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { UserProfile } from "@/types/user.types";
import OverviewRoleSplit from "./OverviewRoleSplit";

vi.mock("next-intl/server", () => ({ getTranslations: async () => (key: string) => key }));
vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("@/components/DivisionIcon", () => ({ default: () => null }));

describe("profile role split", () => {
  it("includes every leaf and unassigned maps in parent totals and pool shares", async () => {
    const profile = {
      maps_total: 40,
      tournaments_count: 3,
      roles: [
        { role: { dimension: "player_role", role: "damage_hitscan", parent: "damage" }, maps: 10, maps_won: 6, tournaments: 1, division: 5 },
        { role: { dimension: "player_role", role: "damage_projectile", parent: "damage" }, maps: 20, maps_won: 4, tournaments: 1, division: 5 },
        { role: null, maps: 10, maps_won: 5, tournaments: 1, division: 5 }
      ]
    } as UserProfile;
    const html = renderToStaticMarkup(await OverviewRoleSplit({ profile }));
    expect(html).toContain("10W · 20L");
    expect(html).toContain("33.3%");
    expect(html).toContain("75.0%");
    expect(html).toContain("common.roles.flex");
    expect(html).toContain("5W · 5L");
    expect(html).toContain("25.0%");
  });
});
