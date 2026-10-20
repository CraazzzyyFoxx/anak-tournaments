// @vitest-environment happy-dom
//
// `/users` under "all games" (spec §6.7): one row per player across every game, a mark per game played that narrows
// the scope, no role chips or division facet (a hint opens the pill instead), and no game-bound columns.
import { QueryClientProvider } from "@tanstack/react-query";
import { NextIntlClientProvider } from "next-intl";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { makeQueryClient } from "@/app/providers";
import { useScopePillOpen } from "@/components/workspace/scope-pill-store";
import en from "@/i18n/messages/en.json";
import { useWorkspaceStore } from "@/stores/workspace.store";
import { PillPick } from "@/test/pill-pick";

import UsersClient from "./UsersClient";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const { push } = vi.hoisted(() => ({ push: vi.fn() }));

vi.mock("next/navigation", () => ({
  usePathname: () => "/users",
  useSearchParams: () => new URLSearchParams(window.location.search),
  useRouter: () => ({ push, replace: vi.fn(), refresh: vi.fn() })
}));
vi.mock("@/hooks/useCurrentWorkspace", () => ({
  useCurrentWorkspaceId: () => 1,
  useDivisionGrid: () => ({ tiers: [] })
}));
// Two installed games with their marks' short names; metadata stays the shared fixture (imported inside the factory:
// `vi.mock` factories are hoisted above the static imports).
vi.mock("@/services/discipline.service", async () => {
  const { disciplineServiceMock, LOL_METADATA, OW_METADATA } = await import("@/test/discipline-metadata");
  return {
    default: {
      ...disciplineServiceMock.default,
      list: async () => [
        { ...OW_METADATA.discipline, short_name: "OW", icon: null },
        { ...LOL_METADATA.discipline, short_name: "LoL", icon: null }
      ]
    }
  };
});

const ROW = {
  id: 7,
  name: "Ana#1234",
  avatar_url: null,
  disciplines: ["overwatch", "lol"],
  roles: [],
  top_characters: [],
  tournaments_count: 9,
  achievements_count: 3,
  maps_won: 24,
  maps_lost: 16,
  encounters_played: 30,
  best_placement: 2,
  last_active_at: null,
  averages: { avg_placement: 4, avg_playoff_placement: 3, avg_group_placement: 5, avg_closeness: 0.5 }
};
const STATS = {
  total_players: 1,
  with_logs_count: 0,
  with_logs_pct: 0,
  avg_tournaments_per_player: 9,
  median_tournaments_per_player: 9,
  active_last_30d: 0,
  active_last_30d_pct: 0,
  role_counts: {},
  flex_count: 0,
  flex_declared_count: 0,
  division_counts: []
};

const fetchMock = vi.fn(async (url: string) => {
  const body = url.startsWith("/api/v1/users/overview/stats")
    ? STATS
    : url.startsWith("/api/v1/users/overview?")
      ? { page: 1, per_page: 20, total: 1, results: [ROW], division_grids: [] }
      : null;
  if (body === null) throw new Error(`unexpected request ${url}`);
  return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
});

let container: HTMLDivElement;
let root: Root;

const settle = async () => {
  for (let i = 0; i < 12; i += 1) {
    await act(async () => {
      const { promise, resolve } = Promise.withResolvers<void>();
      setTimeout(resolve, 0);
      await promise;
    });
  }
};

const render = async () => {
  await act(async () => {
    root.render(
      <QueryClientProvider client={makeQueryClient()}>
        <NextIntlClientProvider locale="en" messages={en} timeZone="UTC">
          <UsersClient
            scope="workspace"
            initial={{ stored: "all", lastGame: null, axis: 1, hostLockedWorkspaceId: null, disciplines: null }}
          />
        </NextIntlClientProvider>
      </QueryClientProvider>
    );
  });
  await settle();
};

const overviewReads = () =>
  fetchMock.mock.calls.map(([url]) => url).filter((url) => url.startsWith("/api/v1/users/overview?"));

beforeEach(() => {
  window.history.replaceState(null, "", "/users");
  useWorkspaceStore.setState({ gameScope: "all" });
  fetchMock.mockClear();
  push.mockClear();
  vi.stubGlobal("fetch", fetchMock);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

it("reads every game: no discipline and no game-bound filter on the wire", async () => {
  window.history.replaceState(null, "", "/users?role=tank&div=3");
  await render();

  expect(overviewReads()).toHaveLength(1);
  const query = new URL(overviewReads()[0], "http://local").searchParams;
  expect(query.has("discipline")).toBe(false);
  expect(query.has("role")).toBe(false);
  expect(query.has("divisions")).toBe(false);
});

it("swaps the role chips and the division facet for the scope hint", async () => {
  await render();

  const buttons = [...container.querySelectorAll("button")].map((button) => button.textContent ?? "");
  expect(buttons.some((text) => text.startsWith("Tank"))).toBe(false);
  expect(container.textContent).not.toContain(en.users.list.filters.divisions);
  expect(container.textContent).toContain(en.common.discipline.filterHint);
});

it("shows a game column instead of roles and top heroes", async () => {
  await render();

  const headers = [...container.querySelectorAll("th")].map((th) => th.textContent ?? "");
  expect(headers).toContain(en.common.discipline.column);
  expect(headers).not.toContain(en.users.list.table.roles);
  expect(headers).not.toContain(en.users.list.table.topHeroes);
  // The row and its phone card both mark the games played.
  expect(container.querySelectorAll('button[aria-label="Overwatch"]')).toHaveLength(2);
});

it("shows each player's maps won and lost beside the winrate, in the row and its card", async () => {
  await render();

  const record = en.users.list.table.mapsRecord.replace("{won}", "24").replace("{lost}", "16");
  expect(container.querySelector("tbody tr")?.textContent).toContain(record);
  expect(container.querySelector("article")?.textContent).toContain(record);
});

it("registers its game-bound params, which a pill game pick drops (R5)", async () => {
  useWorkspaceStore.setState({ gameScope: "overwatch" });
  window.history.replaceState(null, "", "/users?discipline=overwatch&role=tank&div=3");
  await render();

  const registered = useScopePillOpen.getState().gameBoundParams;
  expect([...registered].sort()).toEqual(["div", "role"]);

  // What the pill does on a game pick (R5): Overwatch -> League drops the registered params.
  const pill = document.createElement("div");
  const pillRoot = createRoot(pill);
  await act(async () => {
    pillRoot.render(
      <QueryClientProvider client={makeQueryClient()}>
        <PillPick code="lol" />
      </QueryClientProvider>
    );
  });
  await act(async () => pill.querySelector<HTMLButtonElement>("[data-pill-pick=lol]")?.click());
  act(() => pillRoot.unmount());

  const target = new URL(String(push.mock.calls.at(-1)?.[0]), "http://local").searchParams;
  expect(target.get("discipline")).toBe("lol");
  expect(target.has("role")).toBe(false);
  expect(target.has("div")).toBe(false);
});

it("narrows the scope to a game from a row's mark, leaving the one-game filters behind", async () => {
  window.history.replaceState(null, "", "/users?role=tank&query=ana");
  await render();

  const mark = container.querySelector<HTMLButtonElement>('button[aria-label="League of Legends"]');
  expect(mark).not.toBeNull();
  await act(async () => mark?.click());

  expect(useWorkspaceStore.getState().gameScope).toBe("lol");
  const target = new URL(String(push.mock.calls.at(-1)?.[0]), "http://local").searchParams;
  expect(target.get("discipline")).toBe("lol");
  expect(target.has("role")).toBe(false);
  expect(target.get("query")).toBe("ana");
});

it("an unknown game's way out shows every game without its game-bound filters", async () => {
  window.history.replaceState(null, "", "/users?discipline=nope&role=tank&div=3&query=ana");
  await render();

  expect(overviewReads()).toHaveLength(0);
  const showAll = [...container.querySelectorAll("button")].find(
    (button) => button.textContent === en.common.discipline.showAll
  );
  await act(async () => showAll?.click());

  expect(push.mock.calls.at(-1)?.[0]).toBe("/users?query=ana");
});
