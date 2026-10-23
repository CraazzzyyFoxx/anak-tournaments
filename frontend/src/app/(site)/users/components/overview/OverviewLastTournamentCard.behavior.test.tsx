// @vitest-environment happy-dom
//
// A player entered in a tournament that has no recorded maps yet (not played,
// or results not uploaded) gets an all-zero payload. Rendered literally that is
// "Placed 0 · 0m playtime · 0 maps · 0W · 0L", which reads as lost data — the
// card must say there is no data yet instead.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NextIntlClientProvider } from "next-intl";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import en from "@/i18n/messages/en.json";
import { disciplineQueryKeys } from "@/lib/site/discipline-query-keys";
import { LOL_METADATA, OW_METADATA } from "@/test/discipline-metadata";
import type { UserTournamentWithStats } from "@/types/user.types";

vi.mock("next/navigation", () => ({
  usePathname: () => "/users/Player-1",
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: () => {}, replace: () => {} })
}));
vi.mock("@/components/DivisionIcon", () => ({ default: () => null }));
vi.mock("@/app/(site)/users/components/overview/LobbyLeaderboardModal", () => ({ default: () => null }));

import OverviewLastTournamentCard from "./OverviewLastTournamentCard";

const WORKSPACE_ID = 7;

function tournament(over: Partial<UserTournamentWithStats> = {}): UserTournamentWithStats {
  return {
    id: 5,
    name: "Spring Cup #5",
    workspace_id: WORKSPACE_ID,
    discipline: "overwatch",
    division: 5,
    division_grid_version: null,
    role: { dimension: "player_role", role: "damage" },
    group_placement: 0,
    playoff_placement: 0,
    maps_won: 0,
    maps: 0,
    playtime: 0,
    stats: {} as UserTournamentWithStats["stats"],
    ...over
  };
}

/** The tournament's workspace runs a Hitscan sub-role under Damage; the global ontology has no children. */
const OW_WORKSPACE_METADATA = {
  ...OW_METADATA,
  workspace_id: WORKSPACE_ID,
  roles: [
    ...OW_METADATA.roles,
    {
      ...OW_METADATA.roles[1],
      id: 21,
      code: "damage_hitscan",
      name: "Hitscan",
      parent_id: OW_METADATA.roles[1].id,
      workspace_id: WORKSPACE_ID,
      sort_order: 21,
      attrs: {}
    }
  ]
};

function render(t: UserTournamentWithStats) {
  const client = new QueryClient();
  // Only the tournament's own workspace axis is seeded: a read on any other axis would find nothing.
  client.setQueryData(disciplineQueryKeys.metadata(WORKSPACE_ID, "overwatch"), OW_WORKSPACE_METADATA);
  client.setQueryData(disciplineQueryKeys.metadata(WORKSPACE_ID, "lol"), { ...LOL_METADATA, workspace_id: WORKSPACE_ID });
  return renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <NextIntlClientProvider locale="en" messages={en}>
        <OverviewLastTournamentCard tournament={t} tournaments={[]} userId={1} mapPips={[]} />
      </NextIntlClientProvider>
    </QueryClientProvider>
  );
}

describe("OverviewLastTournamentCard without recorded maps", () => {
  it("states that there is no data instead of printing zeros", () => {
    const html = render(tournament());

    expect(html).toContain(en.users.overview.lastTournament.noData);
    expect(html).not.toContain(en.users.overview.lastTournament.placed);
    expect(html).not.toContain(en.users.overview.lastTournament.mapWinrate);
  });

  it("shows the real numbers once the tournament has maps", () => {
    const html = render(tournament({ maps: 10, maps_won: 2, group_placement: 14, playtime: 6660 }));

    expect(html).not.toContain(en.users.overview.lastTournament.noData);
    expect(html).toContain(en.users.overview.lastTournament.placed);
    expect(html).toContain(">14<");
  });
});

describe("OverviewLastTournamentCard role", () => {
  it("names and tints the role played from the tournament's own ontology", () => {
    const html = render(tournament());

    expect(html).toContain(">Damage<");
    expect(html).toContain("/test-roles/damage.svg");
  });

  it("names a sub-role of the tournament's workspace, drawn with its parent's glyph", () => {
    const html = render(tournament({ role: { dimension: "player_role", role: "damage_hitscan", parent: "damage" } }));

    expect(html).toContain(">Hitscan<");
    expect(html).toContain("/test-roles/damage.svg");
  });

  it("draws a League position in League's ontology, not an Overwatch role", () => {
    const html = render(tournament({ discipline: "lol", role: { dimension: "position", role: "jungle" } }));

    expect(html).toContain(">Jungle<");
    expect(html).toContain("/test-roles/jungle.svg");
  });
});
