// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import en from "@/i18n/messages/en.json";
import type { GameScope } from "@/lib/site/discipline-scope";
import { navigation } from "@/test/url-navigation";
import { useAuthProfileStore } from "@/stores/auth-profile.store";
import { useWorkspaceStore } from "@/stores/workspace.store";
import type { DisciplineDescriptor } from "@/types/discipline.types";
import type { Encounter } from "@/types/encounter.types";
import type { LookupItem, PaginatedResponse } from "@/types/pagination.types";

import EncountersClient from "./EncountersClient";
import { DEFAULT_FILTERS, EMPTY_OVERVIEW } from "./encounters.helpers";
import type { EncountersSeed } from "./useEncountersData";
import { PillPick } from "@/test/pill-pick";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  getAll: vi.fn(),
  getOverview: vi.fn(),
  getSavedViews: vi.fn(),
  lookup: vi.fn(),
  list: vi.fn()
}));

// `vi.mock` factories run before the file's static imports exist, hence the import inside.
vi.mock("next/navigation", async () => (await import("@/test/url-navigation")).nextNavigationMock);
vi.mock("@/services/encounter.service", () => ({
  default: { getAll: mocks.getAll, getOverview: mocks.getOverview, getSavedViews: mocks.getSavedViews }
}));
vi.mock("@/services/tournament.service", () => ({ default: { lookup: mocks.lookup } }));
vi.mock("@/services/discipline.service", () => ({ default: { list: mocks.list } }));
// The rows are the subject; the table's cells are covered by its own suite. `data-marked` is whether the page asked
// the table to name each row's game.
vi.mock("@/components/EncountersTable", () => ({
  FULL_ENCOUNTER_COLUMNS: [],
  EncountersDataTable: ({ rows, games }: { rows: Encounter[]; games?: Map<string, unknown> }) => (
    <ul data-marked={games ? "yes" : "no"}>
      {rows.map((row) => (
        <li key={row.id} data-row={row.id} data-game={row.discipline} />
      ))}
    </ul>
  )
}));
// The picker's options are the subject (the Radix select only renders them while open); `data-game-bound` is whether
// the game-bound filters are offered at all.
vi.mock("./EncountersFilterBar", () => ({
  EncountersFilterBar: ({ tournaments, gameBound }: { tournaments: LookupItem[]; gameBound: boolean }) => (
    <ol data-game-bound={String(gameBound)}>
      {tournaments.map((item) => (
        <li key={item.id} data-tournament={item.name} />
      ))}
    </ol>
  )
}));

const GAMES = [
  { code: "overwatch", name: "Overwatch", short_name: "OW", icon: null, enabled: true },
  { code: "lol", name: "League of Legends", short_name: "LoL", icon: null, enabled: true }
] as DisciplineDescriptor[];

/** One row per game read: `null` is every game. */
const pageOf = (game: string | null, page = 1): PaginatedResponse<Encounter> => {
  const codes = game === null ? ["overwatch", "lol"] : [game];
  return {
    page,
    per_page: 15,
    total: codes.length,
    results: codes.map((code) => ({ id: code === "lol" ? 2 : 1, discipline: code }) as Encounter)
  };
};

const seedOf = (game: string | null, page = 1): EncountersSeed => ({
  discipline: game,
  data: pageOf(game, page),
  overview: EMPTY_OVERVIEW
});

const TOURNAMENTS: Record<string, LookupItem[]> = {
  overwatch: [{ id: 11, name: "OW Cup" }],
  lol: [{ id: 22, name: "LoL Cup" }]
};

type ListArgs = [
  number,
  string,
  null,
  number,
  string,
  string,
  unknown,
  { discipline: string | null },
  { signal: AbortSignal }
];

let root: Root;
let container: HTMLElement;

// list → resolve → read → render needs several turns; one wait is not enough.
const tick = async () => {
  for (let turn = 0; turn < 3; turn++) {
    const { promise, resolve } = Promise.withResolvers<void>();
    setTimeout(resolve, 10);
    await act(() => promise);
  }
};

async function mount(
  seed: EncountersSeed | null,
  initialPage = 1,
  initialFilters = DEFAULT_FILTERS,
  stored: GameScope = "all"
) {
  // The app's defaults: a seeded first page is fresh, not refetched on mount.
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 60_000 } } });
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={en} timeZone="UTC">
        <QueryClientProvider client={client}>
          <EncountersClient
            seed={seed}
            initial={{ stored, lastGame: null, axis: "all", hostLockedWorkspaceId: null, disciplines: GAMES }}
            initialFilters={initialFilters}
            initialPage={initialPage}
            scope="all"
          />
          <PillPick code="lol" />
        </QueryClientProvider>
      </NextIntlClientProvider>
    );
  });
  await tick();
}

const rows = () => [...container.querySelectorAll("[data-row]")].map((row) => row.getAttribute("data-game"));
const marked = () => container.querySelector("[data-marked]")?.getAttribute("data-marked");
const gameBound = () => container.querySelector("[data-game-bound]")?.getAttribute("data-game-bound");
const tournaments = () =>
  [...container.querySelectorAll("[data-tournament]")].map((item) => item.getAttribute("data-tournament"));
const listRead = (game: string | null, page = 1) =>
  [
    page,
    "",
    null,
    15,
    "id",
    "desc",
    "all",
    expect.objectContaining({ discipline: game }),
    { signal: expect.any(AbortSignal) }
  ] as const;

beforeEach(() => {
  mocks.getAll
    .mockReset()
    .mockImplementation(async (...args: ListArgs) => pageOf(args[7].discipline, args[0]));
  mocks.getOverview.mockReset().mockResolvedValue(EMPTY_OVERVIEW);
  mocks.getSavedViews.mockReset().mockResolvedValue([]);
  mocks.lookup.mockReset().mockImplementation(async (_workspace: unknown, game: string) => TOURNAMENTS[game]);
  mocks.list.mockReset().mockResolvedValue(GAMES);
  document.body.innerHTML = "";
  document.cookie = "owt-discipline=; Max-Age=0; path=/";
  container = document.body.appendChild(document.createElement("div"));
  root = createRoot(container);
  useWorkspaceStore.setState({
    currentWorkspaceId: 1,
    statsScope: "all",
    hostLockedWorkspaceId: null,
    gameScope: "all",
    lastGame: null
  });
});

afterEach(async () => {
  await act(async () => root.unmount());
  useAuthProfileStore.setState({ status: "idle", user: undefined });
});

describe("the encounters index across games", () => {
  it("reads every game under all games, names each row's game, and never rewrites the URL on landing", async () => {
    navigation.reset("/encounters");
    await mount(null);

    expect(mocks.getAll).toHaveBeenCalledTimes(1);
    expect(mocks.getAll).toHaveBeenCalledWith(...listRead(null));
    expect(mocks.getOverview).toHaveBeenCalledWith("", expect.objectContaining({ discipline: null }), "all", {
      signal: expect.any(AbortSignal)
    });
    expect(rows()).toEqual(["overwatch", "lol"]);
    expect(marked()).toBe("yes");
    // The tournament/stage pickers are one game's: under every game they give way to the hint, and nothing is looked up.
    expect(gameBound()).toBe("false");
    expect(mocks.lookup).not.toHaveBeenCalled();
    expect(navigation.replaces).toEqual([]);
    expect(navigation.pushes).toEqual([]);
  });

  it("reads one game when the URL names it, with no row marks and every filter offered", async () => {
    navigation.reset("/encounters?discipline=overwatch");
    await mount(null);

    expect(mocks.getAll).toHaveBeenCalledWith(...listRead("overwatch"));
    expect(rows()).toEqual(["overwatch"]);
    expect(marked()).toBe("no");
    expect(gameBound()).toBe("true");
    expect(navigation.replaces).toEqual([]);
  });

  it("narrows to the saved game scope when the URL names none", async () => {
    useWorkspaceStore.setState({ gameScope: "lol" });
    navigation.reset("/encounters");
    await mount(null, 1, DEFAULT_FILTERS, "lol");

    expect(mocks.getAll).toHaveBeenCalledWith(...listRead("lol"));
    expect(rows()).toEqual(["lol"]);
    expect(navigation.replaces).toEqual([]);
  });

  it("a new game starts on its first page without the old game's tournament/stage and never shows its rows while it loads", async () => {
    const lol = Promise.withResolvers<PaginatedResponse<Encounter>>();
    mocks.getAll.mockImplementation((...args: ListArgs) =>
      args[7].discipline === "lol" ? lol.promise : Promise.resolve(pageOf(args[7].discipline, args[0]))
    );
    const url = "/encounters?discipline=overwatch&page=2&tournament_id=11&stage_id=5";
    navigation.reset(url);
    window.history.replaceState(null, "", url);
    await mount(seedOf("overwatch", 2), 2, { ...DEFAULT_FILTERS, tournament_id: 11, stage_id: 5 });

    // The server's read is this game's: shown as is, not read again.
    expect(rows()).toEqual(["overwatch"]);
    expect(mocks.getAll).not.toHaveBeenCalled();
    expect(mocks.getOverview).not.toHaveBeenCalled();

    // A link or the address bar names another game (not the pill, which would also drop the ids from the URL).
    await act(async () => navigation.push("/encounters?discipline=lol&tournament_id=11&stage_id=5"));
    await tick();

    // The filter state, and the URL mirrored from it, leave the old game's ids behind.
    expect(window.location.search).toBe("?discipline=lol");
    expect(mocks.getAll).toHaveBeenCalledTimes(1);
    expect(mocks.getAll).toHaveBeenCalledWith(...listRead("lol", 1));
    expect((mocks.getAll.mock.calls[0] as ListArgs)[7]).toMatchObject({ tournament_id: null, stage_id: null });
    expect(mocks.getOverview).toHaveBeenCalledWith(
      "",
      expect.objectContaining({ discipline: "lol", tournament_id: null, stage_id: null }),
      "all",
      { signal: expect.any(AbortSignal) }
    );
    expect(rows()).toEqual([]);

    await act(async () => lol.resolve(pageOf("lol")));
    await tick();
    expect(rows()).toEqual(["lol"]);
  });

  it("a game changed in the URL drops the previous game's pending read and ignores its late answer", async () => {
    const overwatch = Promise.withResolvers<PaginatedResponse<Encounter>>();
    let overwatchSignal: AbortSignal | undefined;
    mocks.getAll.mockImplementation((...args: ListArgs) => {
      if (args[7].discipline !== "overwatch") return Promise.resolve(pageOf(args[7].discipline));
      overwatchSignal = args[8].signal;
      return overwatch.promise;
    });
    navigation.reset("/encounters?discipline=overwatch");
    // The server's read of another game never stands in for this one.
    await mount(seedOf("lol"));
    expect(rows()).toEqual([]);

    await act(async () => navigation.push("/encounters?discipline=lol"));
    await tick();
    expect(rows()).toEqual(["lol"]);
    expect(overwatchSignal?.aborted).toBe(true);

    await act(async () => overwatch.resolve(pageOf("overwatch")));
    await tick();
    expect(rows()).toEqual(["lol"]);
  });

  it("the tournament picker offers only the resolved game's tournaments, none of the previous game's after a switch", async () => {
    const lol = Promise.withResolvers<LookupItem[]>();
    mocks.lookup.mockImplementation((_workspace: unknown, game: string) =>
      game === "lol" ? lol.promise : Promise.resolve(TOURNAMENTS[game])
    );
    navigation.reset("/encounters?discipline=overwatch");
    await mount(seedOf("overwatch"));

    expect(mocks.lookup).toHaveBeenCalledWith("all", "overwatch", { signal: expect.any(AbortSignal) });
    expect(tournaments()).toEqual(["OW Cup"]);

    await act(async () => navigation.push("/encounters?discipline=lol"));
    await tick();
    expect(mocks.lookup).toHaveBeenLastCalledWith("all", "lol", { signal: expect.any(AbortSignal) });
    expect(tournaments()).toEqual([]);

    await act(async () => lol.resolve(TOURNAMENTS.lol));
    await tick();
    expect(tournaments()).toEqual(["LoL Cup"]);
  });

  it("names an unknown requested game, reads nothing, leaves the URL as typed, and offers every game", async () => {
    navigation.reset("/encounters?discipline=xx");
    await mount(seedOf("overwatch"));

    expect(container.textContent).toContain('"xx" is not an installed game.');
    expect(rows()).toEqual([]);
    expect(mocks.getAll).not.toHaveBeenCalled();
    expect(mocks.getOverview).not.toHaveBeenCalled();
    expect(mocks.lookup).not.toHaveBeenCalled();
    expect(navigation.current()).toBe("/encounters?discipline=xx");

    const showAll = [...container.querySelectorAll("button")].find(
      (button) => button.textContent?.trim() === en.common.discipline.showAll
    );
    await act(async () => showAll?.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    await tick();

    expect(new URL(navigation.pushes.at(-1)!, "http://x").searchParams.has("discipline")).toBe(false);
    expect(useWorkspaceStore.getState().gameScope).toBe("all");
    expect(rows()).toEqual(["overwatch", "lol"]);
  });

  it("a game picked in the scope pill drops this page's tournament/stage params and keeps the rest", async () => {
    const url = "/encounters?tournament_id=11&stage_id=5&best_of=3";
    navigation.reset(url);
    window.history.replaceState(null, "", url);
    await mount(null, 1, { ...DEFAULT_FILTERS, tournament_id: 11, stage_id: 5, best_of: 3 });

    await act(async () => {
      container.querySelector("[data-pill-pick=lol]")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await tick();

    const pushed = new URL(navigation.pushes.at(-1)!, "http://x").searchParams;
    expect(pushed.get("discipline")).toBe("lol");
    expect(pushed.has("tournament_id")).toBe(false);
    expect(pushed.has("stage_id")).toBe(false);
    // Not game-bound: kept.
    expect(pushed.get("best_of")).toBe("3");
  });

  it("under every game no tournament/stage reaches a read or the URL: not the landing URL's, nor a saved view's", async () => {
    // A signed-in viewer's saved view narrowed to one game's stage.
    useAuthProfileStore.setState({ status: "authenticated", user: { username: "fan" } as never });
    mocks.getSavedViews.mockResolvedValue([
      { id: 7, workspace_id: 1, name: "Stage five", filters: { stage_id: 5, best_of: 5 }, sort_order: 0 }
    ]);
    const url = "/encounters?tournament_id=11&best_of=3";
    navigation.reset(url);
    window.history.replaceState(null, "", url);
    await mount(null, 1, { ...DEFAULT_FILTERS, tournament_id: 11, best_of: 3 });

    expect(mocks.getAll).toHaveBeenCalledTimes(1);
    expect(mocks.getAll).toHaveBeenCalledWith(...listRead(null));
    expect((mocks.getAll.mock.calls[0] as ListArgs)[7]).toMatchObject({ tournament_id: null, best_of: 3 });
    expect(mocks.getOverview).toHaveBeenCalledWith(
      "",
      expect.objectContaining({ discipline: null, tournament_id: null, best_of: 3 }),
      "all",
      { signal: expect.any(AbortSignal) }
    );

    const saved = [...container.querySelectorAll("button")].find((button) => button.textContent?.trim() === "Stage five");
    await act(async () => saved?.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    await tick();

    expect((mocks.getAll.mock.lastCall as ListArgs)[7]).toMatchObject({ discipline: null, stage_id: null, best_of: 5 });
    expect(window.location.search).toBe("?best_of=5");
  });

  it("leaving an unknown requested game for every game drops its tournament/stage and starts on the first page", async () => {
    const url = "/encounters?discipline=xx&page=2&tournament_id=11&stage_id=5&best_of=3";
    navigation.reset(url);
    window.history.replaceState(null, "", url);
    await mount(null, 2, { ...DEFAULT_FILTERS, tournament_id: 11, stage_id: 5, best_of: 3 });

    const showAll = [...container.querySelectorAll("button")].find(
      (button) => button.textContent?.trim() === en.common.discipline.showAll
    );
    await act(async () => showAll?.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    await tick();

    expect(navigation.pushes).toEqual(["/encounters?best_of=3"]);
    expect(mocks.getAll).toHaveBeenCalledTimes(1);
    expect(mocks.getAll).toHaveBeenCalledWith(...listRead(null, 1));
    expect((mocks.getAll.mock.calls[0] as ListArgs)[7]).toMatchObject({ tournament_id: null, stage_id: null, best_of: 3 });
    expect(window.location.search).toBe("?best_of=3");
    expect(rows()).toEqual(["overwatch", "lol"]);
  });

  it("a game changed in the URL to an unknown one leaves that URL as typed until the viewer recovers", async () => {
    const url = "/encounters?discipline=overwatch&page=2&tournament_id=11&stage_id=5&best_of=3";
    navigation.reset(url);
    window.history.replaceState(null, "", url);
    await mount(seedOf("overwatch", 2), 2, { ...DEFAULT_FILTERS, tournament_id: 11, stage_id: 5, best_of: 3 });

    // A link or the address bar names a game that is not installed; the router moves the address bar with it.
    const invalid = "/encounters?discipline=xx&page=3&tournament_id=11&stage_id=5&best_of=3";
    window.history.pushState(null, "", invalid);
    await act(async () => navigation.push(invalid));
    await tick();

    expect(container.textContent).toContain('"xx" is not an installed game.');
    expect(window.location.search).toBe("?discipline=xx&page=3&tournament_id=11&stage_id=5&best_of=3");

    const showAll = [...container.querySelectorAll("button")].find(
      (button) => button.textContent?.trim() === en.common.discipline.showAll
    );
    await act(async () => showAll?.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    await tick();

    expect(navigation.pushes.at(-1)).toBe("/encounters?best_of=3");
    expect(mocks.getAll).toHaveBeenCalledWith(...listRead(null, 1));
    expect((mocks.getAll.mock.lastCall as ListArgs)[7]).toMatchObject({ tournament_id: null, stage_id: null, best_of: 3 });
    expect(window.location.search).toBe("?best_of=3");
  });
});
