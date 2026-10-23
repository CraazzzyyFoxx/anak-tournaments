// @vitest-environment happy-dom
import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import en from "@/i18n/messages/en.json";
import { ApiError } from "@/lib/api/error";
import { navigation } from "@/test/url-navigation";
import { useAuthProfileStore } from "@/stores/auth-profile.store";
import { useWorkspaceStore } from "@/stores/workspace.store";
import type { DisciplineDescriptor } from "@/types/discipline.types";
import type { Encounter, EncounterInsights, EncounterOverview } from "@/types/encounter.types";
import type { PaginatedResponse } from "@/types/pagination.types";

import EncountersClient from "./EncountersClient";
import { readEncountersUrl } from "./encounters.helpers";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  getAll: vi.fn(),
  getOverview: vi.fn(),
  getInsights: vi.fn(),
  getSavedViews: vi.fn(),
  saveView: vi.fn(),
  lookup: vi.fn(),
  list: vi.fn()
}));

// `vi.mock` factories run before the file's static imports exist, hence the import inside.
vi.mock("next/navigation", async () => (await import("@/test/url-navigation")).nextNavigationMock);
vi.mock("next/link", () => ({
  default: ({ prefetch: _prefetch, ...rest }: ComponentProps<"a"> & { prefetch?: boolean | null }) => <a {...rest} />
}));
vi.mock("@/services/encounter.service", () => ({ default: mocks }));
vi.mock("@/services/tournament.service", () => ({ default: { lookup: mocks.lookup } }));
vi.mock("@/services/discipline.service", () => ({ default: { list: mocks.list } }));
// The rows are the table suite's subject; here only which page is on screen.
vi.mock("@/components/EncountersTable", () => ({
  EncountersDataTable: ({ rows }: { rows: Encounter[] }) => (
    <ul>
      {rows.map((row) => (
        <li key={row.id} data-row={row.id} />
      ))}
    </ul>
  )
}));

const GAMES = [
  { code: "overwatch", name: "Overwatch", short_name: "OW", icon: null, enabled: true },
  { code: "lol", name: "League of Legends", short_name: "LoL", icon: null, enabled: true }
] as DisciplineDescriptor[];

const overview = (counts: Partial<EncounterOverview["counts"]>, rest: Partial<EncounterOverview> = {}) => ({
  counts: { all: 0, live: 0, upcoming: 0, completed: 0, finals: 0, upsets: 0, with_logs: 0, my_team: 0, ...counts },
  completed_with_logs: 0,
  recent_completed: 0,
  live: [],
  ...rest
});

/** No filters: the hero's numbers. */
const GLOBAL = overview(
  { all: 127, live: 2, upcoming: 5, completed: 120 },
  { completed_with_logs: 30, recent_completed: 4 }
);
/** Anything narrowing: the toolbar's. */
const FILTERED = overview({ all: 40, live: 1, upcoming: 3, completed: 36, finals: 7, upsets: 4, with_logs: 9 });

const INSIGHTS: EncounterInsights = {
  completed: 12,
  avg_closeness: 0.62,
  closeness_histogram: Array.from({ length: 10 }, (_, index) => ({
    start: index / 10,
    end: (index + 1) / 10,
    count: index === 4 ? 3 : index === 7 ? 2 : 0
  })),
  score_lines: [
    { winner: 2, loser: 0, count: 5 },
    { winner: 2, loser: 1, count: 4 }
  ],
  stage_kinds: [
    { kind: "playoffs", count: 8 },
    { kind: "groups", count: 4 }
  ],
  hot_maps: [{ name: "Ilios", count: 6 }],
  closest: [],
  avg_series_seconds: 2520,
  multi_map: 10,
  sweeps: 5,
  went_distance: 4
};

type ListArgs = [number, string, null, number, string, string, unknown, Record<string, unknown>, unknown];

/** 40 rows, 15 a page. */
const pageOf = (page: number): PaginatedResponse<Encounter> => ({
  page,
  per_page: 15,
  total: 40,
  results: Array.from({ length: page < 3 ? 15 : 10 }, (_, index) => ({ id: page * 100 + index }) as Encounter)
});

let root: Root;
let container: HTMLElement;

const tick = async () => {
  for (let turn = 0; turn < 3; turn++) {
    const { promise, resolve } = Promise.withResolvers<void>();
    setTimeout(resolve, 10);
    await act(() => promise);
  }
};

async function mount(url = "/encounters") {
  navigation.reset(url);
  window.history.replaceState(null, "", url);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 60_000 } } });
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={en} timeZone="UTC">
        <QueryClientProvider client={client}>
          <EncountersClient
            seed={null}
            initial={{ stored: "all", lastGame: null, axis: "all", hostLockedWorkspaceId: null, disciplines: GAMES }}
            initialUrl={readEncountersUrl(Object.fromEntries(new URL(url, "http://x").searchParams))}
            scope="all"
          />
        </QueryClientProvider>
      </NextIntlClientProvider>
    );
  });
  await tick();
}

/** Radix opens a menu on `pointerdown`, so a bare click never reaches it. */
async function press(element: Element | null | undefined) {
  expect(element).toBeTruthy();
  await act(async () => {
    element!.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    (element as HTMLElement).click();
  });
  await tick();
}

const byText = (selector: string, text: string) =>
  [...document.querySelectorAll(selector)].find((element) => element.textContent?.trim().startsWith(text));
const segments = () =>
  [...container.querySelectorAll(`[role="radiogroup"][aria-label="${en.common.status}"] [role="radio"]`)].map(
    (radio) => [radio.textContent, radio.getAttribute("aria-checked")]
  );
const lastRead = () => mocks.getAll.mock.lastCall as ListArgs;
const chips = () =>
  [...container.querySelectorAll(`[role="group"][aria-label="${en.encounters.chips.label}"] button`)].map(
    (button) => button.getAttribute("aria-label") ?? button.textContent
  );
const openPresets = () => press(byText("button", en.encounters.presets.trigger));

beforeEach(() => {
  mocks.getAll.mockReset().mockImplementation(async (...args: ListArgs) => pageOf(args[0]));
  mocks.getOverview
    .mockReset()
    .mockImplementation(async (query: string, filters: Record<string, unknown>) =>
      query || Object.keys(filters).length > 1 ? FILTERED : GLOBAL
    );
  mocks.getInsights.mockReset().mockResolvedValue(INSIGHTS);
  mocks.getSavedViews.mockReset().mockResolvedValue([]);
  mocks.saveView.mockReset();
  mocks.lookup.mockReset().mockResolvedValue([]);
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
  vi.restoreAllMocks();
});

describe("the encounters toolbar", () => {
  it("counts the segments under the current filters while the hero keeps the global numbers", async () => {
    await mount("/encounters?best_of=5");

    expect(container.textContent).toContain("+4 in 7 days");
    expect(container.textContent).toContain("30 of 120");
    expect(container.textContent).toContain("25%");
    expect(segments()).toEqual([
      ["All40", "true"],
      ["Live1", "false"],
      ["Upcoming3", "false"],
      ["Completed36", "false"]
    ]);

    await press(byText('[role="radio"]', en.encounters.toolbar.status.upcoming));

    // «Предстоят» reads soonest first, whatever the sort select says.
    expect(lastRead()[4]).toBe("scheduled_at");
    expect(lastRead()[5]).toBe("asc");
    expect(lastRead()[7]).toMatchObject({ status: "upcoming", best_of: 5 });
    expect(window.location.search).toBe("?best_of=5&status=upcoming");
  });

  it("a quick filter narrows the filters already set, and its chip takes it off again", async () => {
    await mount("/encounters?best_of=5");
    await openPresets();

    // Anonymous: no «Моя команда».
    expect(byText('[role="menuitemcheckbox"]', en.encounters.presets.myTeam)).toBeUndefined();
    const finals = byText('[role="menuitemcheckbox"]', en.encounters.presets.finals);
    expect(finals?.textContent).toBe(`${en.encounters.presets.finals}7`);
    await press(finals);

    expect(lastRead()[7]).toMatchObject({ best_of: 5, is_final: true });
    expect(window.location.search).toBe("?best_of=5&is_final=true");
    expect(chips()).toEqual([
      "Remove filter: Bo5",
      `Remove filter: ${en.encounters.presets.finals}`,
      en.common.reset
    ]);

    const reads = mocks.getAll.mock.calls.length;
    await press(container.querySelector(`[aria-label="Remove filter: ${en.encounters.presets.finals}"]`));

    // Back to the landing filters: the read already made for them, from the cache.
    expect(mocks.getAll.mock.calls.length).toBe(reads);
    expect(container.querySelectorAll("[data-row]")).toHaveLength(15);
    expect(window.location.search).toBe("?best_of=5");
    expect(chips()).toEqual(["Remove filter: Bo5", en.common.reset]);
  });

  it("a saved view replaces the filters (under every game without its stage) and is checked once it matches", async () => {
    useAuthProfileStore.setState({ status: "authenticated", user: { username: "fan" } as never });
    mocks.getSavedViews.mockResolvedValue([
      { id: 7, workspace_id: 1, name: "Stage five", filters: { stage_id: 5, best_of: 3, is_upset: true }, sort_order: 0 },
      { id: 8, workspace_id: 1, name: "Upsets Bo3", filters: { best_of: 3, is_upset: true }, sort_order: 1 }
    ]);
    await mount("/encounters?is_final=true");
    await openPresets();
    await press(byText('[role="menuitemcheckbox"]', "Stage five"));

    expect(lastRead()[7]).toMatchObject({ is_final: null, best_of: 3, is_upset: true, stage_id: null });
    expect(window.location.search).toBe("?best_of=3&is_upset=true");

    await openPresets();
    expect(byText('[role="menuitemcheckbox"]', "Upsets Bo3")?.getAttribute("aria-checked")).toBe("true");
    expect(byText('[role="menuitemcheckbox"]', "Stage five")?.getAttribute("aria-checked")).toBe("false");
  });

  it("a refused save says why inside the dialog, which stays open", async () => {
    useAuthProfileStore.setState({ status: "authenticated", user: { username: "fan" } as never });
    mocks.saveView.mockRejectedValue(
      new ApiError(409, [{ msg: "A view with this name exists", code: "saved_view_exists" }])
    );
    await mount("/encounters?best_of=5");
    await openPresets();
    await press(byText('[role="menuitem"]', en.encounters.presets.save));

    const form = document.querySelector('[role="dialog"] form');
    await act(async () => {
      form?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    await tick();

    expect(mocks.saveView).toHaveBeenCalledWith(en.encounters.savedViews.defaultName, expect.objectContaining({ best_of: 5 }), 1);
    expect(document.querySelector('[role="dialog"] [role="alert"]')?.textContent).toBe(en.encounters.savedViews.exists);
    expect(document.querySelector("#saved-view-name")?.getAttribute("aria-invalid")).toBe("true");
  });
});

describe("the encounters views", () => {
  it("reads the summary only while it is open, and a histogram bar filters the list to its bucket", async () => {
    await mount("/encounters");
    expect(mocks.getInsights).not.toHaveBeenCalled();

    await press(byText('[role="radio"]', en.encounters.toolbar.view.insights));

    expect(mocks.getInsights).toHaveBeenCalledWith("", { discipline: null }, "all", { signal: expect.any(AbortSignal) });
    expect(window.location.search).toBe("?view=insights");
    expect(container.textContent).toContain("All time · 12 completed encounters");
    expect(container.textContent).toContain("42 min");
    // Sweeps over the multi-map duels, not over every completed one.
    expect(container.textContent).toContain("50%5 sweeps · 4 went the distance · Bo1 excluded");
    const histogram = container.querySelector(`[role="group"][aria-label="${en.encounters.insights.closeness.title}"]`);
    // Ten tenths; only a bucket with encounters in it is a button, labelled with its count.
    expect(histogram?.children).toHaveLength(10);
    expect([...(histogram?.querySelectorAll("button") ?? [])].map((bar) => bar.textContent)).toEqual(["3", "2"]);
    expect(histogram?.nextElementSibling?.textContent).toBe("0%50%100%");

    const calls = mocks.getAll.mock.calls.length;
    await press(histogram?.querySelector('[aria-label^="40%–50%: 3 encounters"]'));

    expect(mocks.getAll.mock.calls.length).toBe(calls + 1);
    expect(lastRead()[7]).toMatchObject({ closeness_min: 0.4, closeness_max: 0.5 });
    expect(window.location.search).toBe("?closeness_min=0.4&closeness_max=0.5");
    expect(container.querySelectorAll("[data-row]")).toHaveLength(15);
  });

  it("another page is a history entry of its own, Back returns to the page before, and a filter only replaces", async () => {
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    const push = vi.spyOn(window.history, "pushState");
    await mount("/encounters");
    expect(container.textContent).toContain("Showing 1–15 of 40");

    await press(container.querySelector('[aria-label="Go to page 2"]'));

    expect(push).toHaveBeenCalledTimes(1);
    expect(push).toHaveBeenLastCalledWith(null, "", "/encounters?page=2");
    expect(scroll).toHaveBeenCalled();
    expect(lastRead()[0]).toBe(2);
    expect(container.textContent).toContain("Showing 16–30 of 40");

    // Back: the browser shows the previous entry and says so.
    window.history.replaceState(null, "", "/encounters");
    await act(async () => window.dispatchEvent(new PopStateEvent("popstate")));
    await tick();

    expect(container.querySelector('[aria-current="page"]')?.textContent).toBe("1");
    expect(window.location.search).toBe("");

    await press(byText('[role="radio"]', en.encounters.toolbar.status.live));
    expect(push).toHaveBeenCalledTimes(1);
    expect(window.location.search).toBe("?status=live");
  });
});
