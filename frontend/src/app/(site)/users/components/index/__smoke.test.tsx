// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NextIntlClientProvider } from "next-intl";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, onTestFinished, vi } from "vitest";

import en from "@/i18n/messages/en.json";
import type { StatsScope } from "@/lib/site/stats-scope";
import userService from "@/services/user.service";
import UsersClient from "./UsersClient";
import { useWorkspaceStore } from "@/stores/workspace.store";
import { disciplineServiceMock, OW_METADATA } from "@/test/discipline-metadata";
import { TEST_LADDER_TIERS } from "@/test/native-ladder";
import { PillPick } from "@/test/pill-pick";
import type { DivisionGrid } from "@/types/workspace.types";
import { DEFAULT_MIN_ENCOUNTERS, parseMinEncounters } from "./users-index.model";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const { search, push, workspaceGrid } = vi.hoisted(() => ({
  search: { current: new URLSearchParams() },
  push: vi.fn(),
  workspaceGrid: { current: { tiers: [] } as DivisionGrid }
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/users",
  useSearchParams: () => search.current,
  useRouter: () => ({ push, replace: vi.fn(), refresh: vi.fn() })
}));
vi.mock("@/hooks/useCurrentWorkspace", () => ({
  useCurrentWorkspaceId: () => 1,
  useDivisionGrid: () => workspaceGrid.current
}));
vi.mock("@/services/discipline.service", async () => (await import("@/test/discipline-metadata")).disciplineServiceMock);

// `vi.mock` factories are hoisted above module scope, so the spy they close
// over has to be hoisted with them.
const { getDraftCard } = vi.hoisted(() => ({
  getDraftCard: vi.fn(async () => ({
    tournaments: 9,
    tournaments_won: 2,
    maps: 40,
    maps_won: 24,
    maps_lost: 16,
    mvp_maps: null,
    best_placement: 2,
    avg_placement: 4,
    roles: [{ role: { dimension: "player_role", role: "tank" }, maps: 40, maps_won: 24 }],
    characters: [],
    recent_tournaments: [
      { id: 3, name: "OWT Cup 12", date: null, role: null, rank: null, placement: 2, teams_count: 16 }
    ]
  }))
}));

vi.mock("@/services/user.service", () => ({
  default: {
    getUsersOverview: vi.fn(async () => ({
      results: [
        {
          id: 7,
          name: "Ana#1234",
          avatar_url: null,
          disciplines: ["overwatch"],
          roles: [{ role: { dimension: "player_role", role: "tank" }, division: 5, division_grid_version_id: null }],
          tournaments_count: 9,
          achievements_count: 3,
          maps_won: 24,
          maps_lost: 16,
          encounters_played: 30,
          best_placement: 2,
          last_active_at: new Date().toISOString(),
          averages: {
            avg_placement: 4,
            avg_playoff_placement: 3,
            avg_group_placement: 5,
            avg_closeness: 0.5
          },
          top_characters: []
        }
      ],
      total: 1,
      page: 1,
      per_page: 20,
      division_grids: []
    })),
    getUsersOverviewStats: vi.fn(async () => ({
      total_players: 100,
      role_counts: { tank: 30, damage: 40, support: 30 },
      flex_count: 12,
      flex_declared_count: 8,
      division_counts: [{ division: 5, count: 11 }],
      with_logs_count: 50,
      with_logs_pct: 50,
      avg_tournaments_per_player: 3.2,
      median_tournaments_per_player: 3,
      active_last_30d: 20,
      active_last_30d_pct: 20
    })),
    getUsersCatalog: vi.fn(async () => ({
      letters: [],
      available_letters: [],
      total: 0,
      division_grids: []
    })),
    getDraftCard
  }
}));

let container: HTMLDivElement;
let root: Root;

const settle = async () => {
  for (let i = 0; i < 8; i += 1) {
    await act(async () => {
      const { promise, resolve } = Promise.withResolvers<void>();
      setTimeout(resolve, 0);
      await promise;
    });
  }
};

beforeEach(() => {
  search.current = new URLSearchParams();
  workspaceGrid.current = { tiers: [] };
  push.mockClear();
  // The index under one game: its role chips, role divisions and drawer are game-bound.
  useWorkspaceStore.setState({ gameScope: "overwatch", lastGame: null });
  vi.mocked(userService.getUsersOverview).mockClear();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  useWorkspaceStore.setState({ gameScope: "all" });
});

const renderIndex = async (scope: StatsScope = "workspace") => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => {
    root.render(
      <QueryClientProvider client={client}>
        <NextIntlClientProvider locale="en" messages={en} timeZone="UTC">
          <UsersClient
            scope={scope}
            initial={{ stored: "all", lastGame: null, axis: scope === "all" ? "all" : 1, hostLockedWorkspaceId: null, disciplines: null }}
          />
          <PillPick code="lol" />
        </NextIntlClientProvider>
      </QueryClientProvider>
    );
  });
  await settle();
};

it("renders a player row with its winrate and sample size", async () => {
  await renderIndex();

  expect(container.textContent).toContain("Ana#1234");
  // 24 of 40 decided maps.
  expect(container.textContent).toContain("60%");
  expect(container.textContent).toContain("30 encounters");
  // The maps record belongs to the cross-game row only.
  expect(container.textContent).not.toContain(en.users.list.table.mapsRecord.replace("{won}", "24").replace("{lost}", "16"));
  // Role chips read their counts from the stats endpoint.
  expect(container.textContent).toContain("100");
});

it("offers the browsed game's own roles as chips, counted per role code", async () => {
  await renderIndex();

  const chips = [...container.querySelectorAll("button")].map((button) => button.textContent ?? "");
  // The scope's game here is Overwatch: its three roles, then the open slot.
  expect(chips).toEqual(expect.arrayContaining(["Tank30", "Damage40", "Support30", "Flex8"]));
});

it("filters the reads on a role chip in the game's rated dimension", async () => {
  search.current = new URLSearchParams("role=support");
  await renderIndex();

  expect(vi.mocked(userService.getUsersOverview)).toHaveBeenLastCalledWith(
    expect.objectContaining({ discipline: "overwatch", role: { dimension: "player_role", role: "support" } })
  );
});

it("reads every player for a role the game does not have", async () => {
  search.current = new URLSearchParams("role=Tank");
  await renderIndex();

  expect(vi.mocked(userService.getUsersOverview)).toHaveBeenLastCalledWith(
    expect.objectContaining({ discipline: "overwatch", role: undefined })
  );
});

it("loads the draft card only once a row is expanded", async () => {
  await renderIndex();
  expect(getDraftCard).not.toHaveBeenCalled();

  const expand = container.querySelector<HTMLButtonElement>(
    `button[aria-label="${en.users.list.a11y.expandDetails}"]`
  );
  expect(expand).not.toBeNull();
  await act(async () => expand?.click());
  await settle();

  // The card is read in the index's game (the scope's), in its workspace.
  expect(getDraftCard).toHaveBeenCalledWith(7, "overwatch", 1);
  expect(container.textContent).toContain("OWT Cup 12");
  expect(container.textContent).toContain(en.users.list.expanded.openProfile);
});

it("sorts by a column header and marks it with aria-sort", async () => {
  await renderIndex();

  const header = [...container.querySelectorAll("th")].find((th) =>
    th.textContent?.includes(en.users.list.table.tournaments)
  );
  expect(header?.getAttribute("aria-sort")).toBe("descending");
});

it("defaults min_encounters when the param is absent, but honours an explicit 0", () => {
  // `Number(null)` and `Number("")` are 0, which is itself a valid option.
  expect(parseMinEncounters(null)).toBe(DEFAULT_MIN_ENCOUNTERS);
  expect(parseMinEncounters("")).toBe(DEFAULT_MIN_ENCOUNTERS);
  expect(parseMinEncounters("0")).toBe(0);
  expect(parseMinEncounters("50")).toBe(50);
  expect(parseMinEncounters("7")).toBe(DEFAULT_MIN_ENCOUNTERS);
});

it("a game picked in the scope pill drops the role and division filters and keeps the search", async () => {
  search.current = new URLSearchParams("role=support&div=3&query=ana");
  await renderIndex();

  await act(async () => {
    container.querySelector("[data-pill-pick=lol]")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });

  const url = new URL(push.mock.calls.at(-1)![0] as string, "http://x");
  expect(url.searchParams.get("discipline")).toBe("lol");
  expect(url.searchParams.has("role")).toBe(false);
  expect(url.searchParams.has("div")).toBe(false);
  expect(url.searchParams.get("query")).toBe("ana");
});

it("crests an all-communities role naming no grid version from the game's native ladder, not the workspace grid", async () => {
  const tier = TEST_LADDER_TIERS.find((entry) => entry.number === 5)!;
  workspaceGrid.current = {
    tiers: [{ number: 5, name: "Workspace Gold", rank_min: 0, rank_max: null, icon_url: "https://cdn.test/ws-gold.png" }]
  };
  const read = disciplineServiceMock.default.metadata;
  const metadata = vi
    .spyOn(disciplineServiceMock.default, "metadata")
    .mockImplementation(async (axis, code) =>
      code === "overwatch" ? { ...OW_METADATA, native_ladder: TEST_LADDER_TIERS } : read(axis, code)
    );
  onTestFinished(() => metadata.mockRestore());

  await renderIndex("all");

  // The row's tank 5 has no version id: across communities it is the 5 of Overwatch's own ladder.
  const title = en.users.list.division.badgeTitle.replace("{role}", "Tank").replace("{tier}", tier.name);
  const crest = container.querySelector<HTMLElement>(`[title="${title}"]`);
  expect(crest?.querySelector("img")?.getAttribute("alt")).toBe(tier.name);
  expect(container.innerHTML).not.toContain("Workspace Gold");
});
