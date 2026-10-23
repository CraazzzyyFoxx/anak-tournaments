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
import type { Encounter, EncounterOverview } from "@/types/encounter.types";
import type { LookupItem, PaginatedResponse } from "@/types/pagination.types";

import EncountersClient from "./EncountersClient";
import { DEFAULT_FILTERS } from "./encounters.helpers";
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
vi.mock("next/navigation", async () => {
  const { nextNavigationMock } = await import("@/test/url-navigation");
  const router = nextNavigationMock.useRouter();
  // The app router moves the address bar with a push (the pill, "Show all games"), as the page's URL mirror expects.
  const addressBarRouter = {
    ...router,
    push: (url: string) => {
      window.history.pushState(null, "", url);
      router.push(url);
    }
  };
  return { ...nextNavigationMock, useRouter: () => addressBarRouter };
});
vi.mock("@/services/encounter.service", () => ({
  default: { getAll: mocks.getAll, getOverview: mocks.getOverview, getSavedViews: mocks.getSavedViews }
}));
vi.mock("@/services/tournament.service", () => ({ default: { lookup: mocks.lookup } }));
vi.mock("@/services/discipline.service", () => ({ default: { list: mocks.list } }));
// The rows are the subject; the table's cells are covered by its own suite. `data-marked` is whether the page asked
// the table to name each row's game.
vi.mock("@/components/EncountersTable", () => ({
  EncountersDataTable: ({ rows, games }: { rows: Encounter[]; games?: Map<string, unknown> }) => (
    <ul data-marked={games ? "yes" : "no"}>
      {rows.map((row) => (
        <li key={row.id} data-row={row.id} data-game={row.discipline} />
      ))}
    </ul>
  )
}));
// The picker's options are the subject (the Radix select only renders them while open); `data-game-bound` is whether
// the game-bound filters are offered at all. `[data-type-search]` types "new" into the search box. The toolbar's own
// controls have their suite (`EncountersToolbar.behavior.test.tsx`).
vi.mock("./EncountersToolbar", () => ({
  EncountersToolbar: ({
    tournaments,
    gameBound,
    controls
  }: {
    tournaments: LookupItem[];
    gameBound: boolean;
    controls: { setSearchValue: (value: string) => void };
  }) => (
    <>
      <ol data-game-bound={String(gameBound)}>
        {tournaments.map((item) => (
          <li key={item.id} data-tournament={item.name} />
        ))}
      </ol>
      <button type="button" data-type-search onClick={() => controls.setSearchValue("new")} />
    </>
  ),
  EncountersActiveFilters: () => null
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

const OVERVIEW: EncounterOverview = {
  counts: { all: 0, live: 0, upcoming: 0, completed: 0, finals: 0, upsets: 0, with_logs: 0, my_team: 0 },
  completed_with_logs: 0,
  recent_completed: 0,
  live: []
};

const seedOf = (game: string | null, page = 1): EncountersSeed => ({
  discipline: game,
  data: pageOf(game, page),
  overview: OVERVIEW,
  counts: OVERVIEW
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

// Longer than the search box's typing debounce (300 ms).
const settle = async () => {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, 350);
  await act(() => promise);
  await tick();
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
            initialUrl={{ page: initialPage, view: "list", filters: initialFilters }}
            scope="all"
          />
          {GAMES.map((game) => (
            <PillPick key={game.code} code={game.code} />
          ))}
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
    "played_at",
    "desc",
    "all",
    expect.objectContaining({ discipline: game }),
    { signal: expect.any(AbortSignal) }
  ] as const;

beforeEach(() => {
  mocks.getAll
    .mockReset()
    .mockImplementation(async (...args: ListArgs) => pageOf(args[7].discipline, args[0]));
  mocks.getOverview.mockReset().mockResolvedValue(OVERVIEW);
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
    // The hero's global overview and the toolbar's counts are one read while nothing narrows.
    expect(mocks.getOverview).toHaveBeenCalledTimes(1);
    expect(mocks.getOverview).toHaveBeenCalledWith("", { discipline: null }, "all", { signal: expect.any(AbortSignal) });
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
    expect(mocks.getOverview).toHaveBeenCalledWith("", { discipline: "lol" }, "all", {
      signal: expect.any(AbortSignal)
    });
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

  it("under every game no tournament/stage reaches a read or the URL, not even the landing URL's", async () => {
    const url = "/encounters?tournament_id=11&best_of=3";
    navigation.reset(url);
    window.history.replaceState(null, "", url);
    await mount(null, 1, { ...DEFAULT_FILTERS, tournament_id: 11, best_of: 3 });

    expect(mocks.getAll).toHaveBeenCalledTimes(1);
    expect(mocks.getAll).toHaveBeenCalledWith(...listRead(null));
    expect((mocks.getAll.mock.calls[0] as ListArgs)[7]).toMatchObject({ tournament_id: null, best_of: 3 });
    // The counts are this filter set's; the hero's stay global.
    expect(mocks.getOverview).toHaveBeenCalledWith("", { best_of: 3, discipline: null }, "all", {
      signal: expect.any(AbortSignal)
    });
    expect(mocks.getOverview).toHaveBeenCalledWith("", { discipline: null }, "all", { signal: expect.any(AbortSignal) });
    expect(window.location.search).toBe("?best_of=3");
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

  it("returning from an unknown game to every game, the scope before it, starts on the first page", async () => {
    const url = "/encounters?page=2";
    navigation.reset(url);
    window.history.replaceState(null, "", url);
    await mount(seedOf(null, 2), 2);
    expect(rows()).toEqual(["overwatch", "lol"]);

    const invalid = "/encounters?discipline=xx&page=2";
    window.history.pushState(null, "", invalid);
    await act(async () => navigation.push(invalid));
    await tick();
    const showAll = [...container.querySelectorAll("button")].find(
      (button) => button.textContent?.trim() === en.common.discipline.showAll
    );
    await act(async () => showAll?.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    await tick();

    expect(navigation.pushes.at(-1)).toBe("/encounters");
    expect(mocks.getAll).toHaveBeenCalledTimes(1);
    expect(mocks.getAll).toHaveBeenCalledWith(...listRead(null, 1));
    expect(window.location.search).toBe("");
  });

  it("returning from an unknown game to the game before it, picked in the pill, leaves its tournament/stage behind", async () => {
    const url = "/encounters?discipline=overwatch&tournament_id=11&stage_id=5";
    navigation.reset(url);
    window.history.replaceState(null, "", url);
    await mount(seedOf("overwatch"), 1, { ...DEFAULT_FILTERS, tournament_id: 11, stage_id: 5 });

    const invalid = "/encounters?discipline=xx&tournament_id=11&stage_id=5";
    window.history.pushState(null, "", invalid);
    await act(async () => navigation.push(invalid));
    await tick();
    await act(async () => {
      container.querySelector("[data-pill-pick=overwatch]")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await tick();

    expect(navigation.pushes.at(-1)).toBe("/encounters?discipline=overwatch");
    expect(mocks.getAll).toHaveBeenCalledTimes(1);
    expect(mocks.getAll).toHaveBeenCalledWith(...listRead("overwatch", 1));
    expect((mocks.getAll.mock.calls[0] as ListArgs)[7]).toMatchObject({ tournament_id: null, stage_id: null });
    // The URL the pill pushed stands: the state has no tournament/stage to mirror back into it.
    expect(window.location.search).toBe("?discipline=overwatch");
  });

  it("Back from an unknown game restores the previous game's page and tournament/stage, and its URL as it was", async () => {
    const url = "/encounters?discipline=overwatch&tournament_id=11&stage_id=5&page=3";
    navigation.reset(url);
    window.history.replaceState(null, "", url);
    await mount(null, 3, { ...DEFAULT_FILTERS, tournament_id: 11, stage_id: 5 });
    expect(mocks.getAll).toHaveBeenCalledTimes(1);
    expect(mocks.getAll).toHaveBeenCalledWith(...listRead("overwatch", 3));
    expect((mocks.getAll.mock.calls[0] as ListArgs)[7]).toMatchObject({ tournament_id: 11, stage_id: 5 });

    const invalid = "/encounters?discipline=xx";
    window.history.pushState(null, "", invalid);
    await act(async () => navigation.push(invalid));
    await tick();
    expect(container.textContent).toContain('"xx" is not an installed game.');

    // Back: the browser shows the previous entry again, and the router follows.
    window.history.replaceState(null, "", url);
    await act(async () => navigation.back());
    await tick();

    // The list is that page of that tournament/stage again, the read already made for it; nothing new is read.
    expect(rows()).toEqual(["overwatch"]);
    expect(mocks.getAll).toHaveBeenCalledTimes(1);
    // The mirror writes its own parameter order; the URL keeps the one it came back with.
    expect(window.location.search).toBe("?discipline=overwatch&tournament_id=11&stage_id=5&page=3");
  });

  it("a search read back from the URL on leaving an unknown game is read at once, not after the typing debounce", async () => {
    const url = "/encounters?search=old";
    navigation.reset(url);
    window.history.replaceState(null, "", url);
    await mount(null, 1, { ...DEFAULT_FILTERS, query: "old" });

    const invalid = "/encounters?discipline=xx&search=new";
    window.history.pushState(null, "", invalid);
    await act(async () => navigation.push(invalid));
    await tick();
    const showAll = [...container.querySelectorAll("button")].find(
      (button) => button.textContent?.trim() === en.common.discipline.showAll
    );
    await act(async () => showAll?.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    await tick();

    expect(navigation.pushes.at(-1)).toBe("/encounters?search=new");
    // The first read after the recovery is the URL's term, and the URL the recovery pushed stands.
    expect(mocks.getAll.mock.calls.map((call) => call[1])).toEqual(["old", "new"]);
    expect(window.location.search).toBe("?search=new");

    await settle();
    expect(mocks.getAll.mock.calls.map((call) => call[1])).toEqual(["old", "new"]);
    expect(window.location.search).toBe("?search=new");
  });

  it.each([
    ["settles on the unknown game's screen", true],
    ["is still settling at Back", false]
  ])("Back from an unknown game reads the URL's search, not a term typed before it that %s", async (_, settlesFirst) => {
    const url = "/encounters?discipline=overwatch&search=old";
    navigation.reset(url);
    window.history.replaceState(null, "", url);
    await mount(null, 1, { ...DEFAULT_FILTERS, query: "old" });

    await act(async () => {
      container.querySelector("[data-type-search]")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    const invalid = "/encounters?discipline=xx";
    window.history.pushState(null, "", invalid);
    await act(async () => navigation.push(invalid));
    await tick();
    if (settlesFirst) await settle();

    window.history.replaceState(null, "", url);
    await act(async () => navigation.back());
    await tick();
    await settle();

    // Nothing reads the typed term, and the URL keeps the order it came back with: the mirror never rewrote it.
    expect(mocks.getAll.mock.calls.map((call) => call[1])).toEqual(["old"]);
    expect(window.location.search).toBe("?discipline=overwatch&search=old");
  });
});
