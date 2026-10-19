// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import en from "@/i18n/messages/en.json";
import { navigation } from "@/test/url-navigation";
import type * as SelectorModule from "@/components/workspace/DisciplineSelector";
import { useWorkspaceStore } from "@/stores/workspace.store";
import type { DisciplineDescriptor } from "@/types/discipline.types";
import type { Encounter } from "@/types/encounter.types";
import type { LookupItem, PaginatedResponse } from "@/types/pagination.types";

import EncountersClient from "./EncountersClient";
import { DEFAULT_FILTERS, EMPTY_OVERVIEW } from "./encounters.helpers";
import type { EncountersSeed } from "./useEncountersData";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  getAll: vi.fn(),
  getOverview: vi.fn(),
  lookup: vi.fn(),
  list: vi.fn()
}));

// `vi.mock` factories run before the file's static imports exist, hence the import inside.
vi.mock("next/navigation", async () => (await import("@/test/url-navigation")).nextNavigationMock);
vi.mock("@/services/encounter.service", () => ({
  default: { getAll: mocks.getAll, getOverview: mocks.getOverview, getSavedViews: vi.fn() }
}));
vi.mock("@/services/tournament.service", () => ({ default: { lookup: mocks.lookup } }));
vi.mock("@/services/discipline.service", () => ({ default: { list: mocks.list } }));
// The rows are the subject; the table's cells are covered by its own suite.
vi.mock("@/components/EncountersTable", () => ({
  FULL_ENCOUNTER_COLUMNS: [],
  EncountersDataTable: ({ rows }: { rows: Encounter[] }) => (
    <ul>
      {rows.map((row) => (
        <li key={row.id} data-row={row.id} data-game={row.discipline} />
      ))}
    </ul>
  )
}));
// The picker's options are the subject; the Radix select only renders them while open.
vi.mock("./EncountersFilterBar", () => ({
  EncountersFilterBar: ({ tournaments }: { tournaments: LookupItem[] }) => (
    <ol>
      {tournaments.map((item) => (
        <li key={item.id} data-tournament={item.name} />
      ))}
    </ol>
  )
}));
// The real selector is a Radix popover; a button per game is the same `onSelect` contract.
vi.mock("@/components/workspace/DisciplineSelector", async (importOriginal) => ({
  ...(await importOriginal<typeof SelectorModule>()),
  DisciplineSelector: ({
    disciplines,
    value,
    onSelect
  }: {
    disciplines: { code: string; name: string }[];
    value: string | undefined;
    onSelect: (code: string) => void;
  }) => (
    <div data-selector={value}>
      {disciplines.map((game) => (
        <button key={game.code} data-pick={game.code} onClick={() => onSelect(game.code)}>
          {game.name}
        </button>
      ))}
    </div>
  )
}));

const GAMES = [
  { code: "overwatch", name: "Overwatch", enabled: true },
  { code: "lol", name: "League of Legends", enabled: true }
] as DisciplineDescriptor[];

const pageOf = (game: string, page = 1): PaginatedResponse<Encounter> => ({
  page,
  per_page: 15,
  total: 1,
  results: [{ id: game === "lol" ? 2 : 1, discipline: game } as Encounter]
});

const seedOf = (game: string, page = 1): EncountersSeed => ({
  discipline: game,
  data: pageOf(game, page),
  overview: EMPTY_OVERVIEW
});

const TOURNAMENTS: Record<string, LookupItem[]> = {
  overwatch: [{ id: 11, name: "OW Cup" }],
  lol: [{ id: 22, name: "LoL Cup" }]
};

type ListArgs = [number, string, null, number, string, string, unknown, { discipline: string }, { signal: AbortSignal }];

let root: Root;
let container: HTMLElement;

// list → resolve → canonical URL → read → render needs several turns; one wait is not enough.
const tick = async () => {
  for (let turn = 0; turn < 3; turn++) {
    const { promise, resolve } = Promise.withResolvers<void>();
    setTimeout(resolve, 10);
    await act(() => promise);
  }
};

async function mount(seed: EncountersSeed | null, initialPage = 1, initialFilters = DEFAULT_FILTERS) {
  // The app's defaults: a seeded first page is fresh, not refetched on mount.
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 60_000 } } });
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={en} timeZone="UTC">
        <QueryClientProvider client={client}>
          <EncountersClient
            seed={seed}
            initial={{ stored: null, axis: "all", hostLockedWorkspaceId: null, disciplines: GAMES }}
            initialFilters={initialFilters}
            initialPage={initialPage}
            scope="all"
          />
        </QueryClientProvider>
      </NextIntlClientProvider>
    );
  });
  await tick();
}

const rows = () => [...container.querySelectorAll("[data-row]")].map((row) => row.getAttribute("data-game"));
const tournaments = () =>
  [...container.querySelectorAll("[data-tournament]")].map((item) => item.getAttribute("data-tournament"));
const listRead = (game: string, page = 1) =>
  [page, "", null, 15, "id", "desc", "all", expect.objectContaining({ discipline: game }), { signal: expect.any(AbortSignal) }] as const;

beforeEach(() => {
  mocks.getAll
    .mockReset()
    .mockImplementation(async (...args: ListArgs) => pageOf(args[7].discipline, args[0]));
  mocks.getOverview.mockReset().mockResolvedValue(EMPTY_OVERVIEW);
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
    gameScope: "all"
  });
});

afterEach(async () => {
  await act(async () => root.unmount());
});

describe("the encounters index is one game at a time", () => {
  it("reads the list and the overview of the resolved game, abortably, and writes the game to the URL", async () => {
    navigation.reset("/encounters");
    await mount(null);

    expect(navigation.replaces).toEqual(["/encounters?discipline=overwatch"]);
    expect(mocks.getAll).toHaveBeenCalledTimes(1);
    expect(mocks.getAll).toHaveBeenCalledWith(...listRead("overwatch"));
    expect(mocks.getOverview).toHaveBeenCalledTimes(1);
    expect(mocks.getOverview).toHaveBeenCalledWith("", expect.objectContaining({ discipline: "overwatch" }), "all", {
      signal: expect.any(AbortSignal)
    });
    expect(rows()).toEqual(["overwatch"]);
  });

  it("a picked game starts on its first page without the old game's tournament/stage and never shows its rows while it loads", async () => {
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

    await act(async () => {
      container.querySelector("[data-pick=lol]")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await tick();

    expect(navigation.pushes).toEqual(["/encounters?discipline=lol"]);
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

  it("names an unknown requested game, reads no encounters and leaves the URL as typed", async () => {
    navigation.reset("/encounters?discipline=xx");
    await mount(seedOf("overwatch"));

    expect(container.textContent).toContain('"xx" is not an installed game.');
    expect(rows()).toEqual([]);
    expect(mocks.getAll).not.toHaveBeenCalled();
    expect(mocks.getOverview).not.toHaveBeenCalled();
    expect(mocks.lookup).not.toHaveBeenCalled();
    expect(navigation.current()).toBe("/encounters?discipline=xx");
  });
});
