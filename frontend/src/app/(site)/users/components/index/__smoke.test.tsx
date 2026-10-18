// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NextIntlClientProvider } from "next-intl";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import en from "@/i18n/messages/en.json";
import { OW_REFERENCE_GRID } from "@/disciplines/overwatch/ladder/ow-reference-grid";
import UsersClient from "./UsersClient";
import { DEFAULT_MIN_ENCOUNTERS, parseMinEncounters } from "./users-index.model";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("next/navigation", () => ({
  usePathname: () => "/users",
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() })
}));
vi.mock("@/hooks/useCurrentWorkspace", () => ({
  useCurrentWorkspaceId: () => 1,
  useDivisionGrid: () => OW_REFERENCE_GRID
}));

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
    heroes: [],
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
          top_heroes: []
        }
      ],
      total: 1,
      page: 1,
      per_page: 20,
      division_grids: []
    })),
    getUsersOverviewStats: vi.fn(async () => ({
      total_players: 100,
      tank_count: 30,
      damage_count: 40,
      support_count: 30,
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
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const renderIndex = async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => {
    root.render(
      <QueryClientProvider client={client}>
        <NextIntlClientProvider locale="en" messages={en} timeZone="UTC">
          <UsersClient scope="workspace" />
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
  // Role chips read their counts from the stats endpoint.
  expect(container.textContent).toContain("100");
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

  expect(getDraftCard).toHaveBeenCalledWith(7, 1);
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
