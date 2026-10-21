import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NextIntlClientProvider } from "next-intl";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import messages from "@/i18n/messages/en.json";
import { disciplineQueryKeys } from "@/lib/site/discipline-query-keys";
import { OW_METADATA } from "@/test/discipline-metadata";
import type { UserProfile } from "@/types/user.types";
import OverviewRoleSplit from "./OverviewRoleSplit";

vi.mock("@/components/DivisionIcon", () => ({ default: () => null }));

const profile = {
  maps_total: 40,
  tournaments_count: 3,
  roles: [
    { role: { dimension: "player_role", role: "damage_hitscan", parent: "damage" }, maps: 10, maps_won: 6, tournaments: 1, division: 5 },
    { role: { dimension: "player_role", role: "damage_projectile", parent: "damage" }, maps: 20, maps_won: 4, tournaments: 1, division: 5 },
    { role: { dimension: "player_role", role: "tank" }, maps: 5, maps_won: 5, tournaments: 2, division: 5 },
    { role: null, maps: 10, maps_won: 5, tournaments: 1, division: 5 }
  ]
} as UserProfile;

const AXIS = 7;

function render() {
  const client = new QueryClient();
  // Only the viewed workspace's axis is seeded: names and hues found here were read on that axis, not the global one.
  client.setQueryData(disciplineQueryKeys.metadata(AXIS, "overwatch"), { ...OW_METADATA, workspace_id: AXIS });
  return renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <NextIntlClientProvider locale="en" messages={messages}>
        <OverviewRoleSplit profile={profile} discipline="overwatch" axis={AXIS} characters={[]} />
      </NextIntlClientProvider>
    </QueryClientProvider>
  );
}

describe("profile role split", () => {
  it("includes every leaf and unassigned maps in parent totals and pool shares", () => {
    const html = render();
    expect(html).toContain("10W · 20L");
    expect(html).toContain("33.3%");
    expect(html).toContain("75.0%");
    expect(html).toContain("5W · 5L");
    expect(html).toContain("25.0%");
  });

  it("names and paints roles from the game's ontology, in its declared order, unassigned last", () => {
    const html = render();
    // Tank (sort order 1) before Damage (2), the unassigned Flex bucket last.
    expect(html.indexOf("Tank")).toBeLessThan(html.indexOf("Damage"));
    expect(html.indexOf("Damage")).toBeLessThan(html.lastIndexOf("Flex"));
    expect(html).toContain("#0ea5e9");
    expect(html).not.toContain("--aqt-tank");
  });
});
