// @vitest-environment happy-dom
//
// The pieces of this table that are not the shared `DataTable`:
//  1. the division range is sent as tier numbers on the workspace grid
//     (`divMin`/`divMax`); the server maps them onto ranks;
//  2. the game chip leads the bar, and a game change drops the old game's role,
//     division range and rank order.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RankOverviewTable } from "@/components/admin/ranks/RankOverviewTable";
import type { RankOverviewListParams, RankOverviewRow } from "@/services/workspace-player.service";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// `router.replace` is the chips' URL write: it lands in `window.location`, which `useSearchParams` reads back.
vi.mock("next/navigation", () => ({
  usePathname: () => "/admin/ranks",
  useRouter: () => ({ replace: (url: string) => window.history.replaceState(null, "", url), push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(window.location.search)
}));

// Message keys, not copy: every assertion is about which fact reaches the row.
vi.mock("next-intl", () => ({
  useTranslations: () =>
    Object.assign((key: string) => key, { has: () => true, rich: (key: string) => key })
}));

vi.mock("@/lib/datetime/client", () => ({
  useFormatter: () => ({ dateTime: (value: Date) => value.toISOString() })
}));

// The workspace grid the division picker draws.
vi.mock("@/hooks/useCurrentWorkspace", () => ({
  useDivisionGrid: () => ({
    tiers: [
      { number: 1, name: "Bronze", rank_min: 500, rank_max: 999, icon_url: "/bronze.png" },
      { number: 2, name: "Silver", rank_min: 1000, rank_max: 1499, icon_url: "/silver.png" },
      { number: 3, name: "Gold", rank_min: 1500, rank_max: null, icon_url: "/gold.png" }
    ]
  })
}));

vi.mock("@/stores/workspace.store", () => ({
  useWorkspaceStore: (selector: (state: { currentWorkspaceId: number }) => unknown) =>
    selector({ currentWorkspaceId: 7 })
}));

// The page's game is a test input; the owner's metadata is the real OW / League fixture.
let browsing = "overwatch";
vi.mock("@/hooks/useGameScope", async () => {
  const { LOL_GAME, OW_GAME, gameScopeStub } = await import("@/test/game-scope");
  return {
    useGameScope: () =>
      gameScopeStub({ kind: "game", code: browsing, source: "url" }, { axis: 7, games: [OW_GAME, LOL_GAME] })
  };
});
vi.mock("@/hooks/useDisciplineMetadata", async () => {
  const { LOL_METADATA, OW_METADATA } = await import("@/test/discipline-metadata");
  return {
    useDisciplineMetadata: (_axis: unknown, code: string) => ({
      data: code === "lol" ? LOL_METADATA : OW_METADATA,
      isError: false,
      refetch: vi.fn()
    }),
    useDisciplines: () => ({ data: [OW_METADATA.discipline, LOL_METADATA.discipline], isError: false, refetch: vi.fn() })
  };
});

const listRanks = vi.fn();
const listAuthors = vi.fn();

vi.mock("@/services/workspace-player.service", async (importOriginal) => {
  // The constants (`RANK_LAYERS`, roles) stay real; only the two reads are stubbed.
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    workspacePlayerService: {
      listRanks: (...args: unknown[]) => listRanks(...args),
      listAuthors: (...args: unknown[]) => listAuthors(...args)
    }
  };
});

function row(overrides: Partial<RankOverviewRow> = {}): RankOverviewRow {
  return {
    layer: "canon",
    discipline: "overwatch",
    player_id: 42,
    member_id: 9,
    display_name: "Alice",
    identity: { provider: "battlenet", handle: "Alice#2100" },
    author_user_id: null,
    author_name: null,
    role: "tank",
    rank_value: 3100,
    division: 2,
    source: null,
    sigma: null,
    delta: null,
    canon_diff: null,
    native_division: null,
    native_tier: null,
    context: null,
    at: "2026-01-02T03:04:05Z",
    ...overrides
  };
}

let container: HTMLElement;
let root: Root;

function lastParams(): RankOverviewListParams {
  return listRanks.mock.calls.at(-1)?.[1] as RankOverviewListParams;
}

async function render(search: string) {
  window.history.replaceState(null, "", `/admin/ranks${search}`);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => {
    root.render(
      <QueryClientProvider client={client}>
        <RankOverviewTable />
      </QueryClientProvider>
    );
  });
  // The page query resolves a macrotask later; without this the body is still
  // the loading skeleton and every row assertion reads an empty table.
  await act(async () => {
    const settled = Promise.withResolvers<void>();
    setTimeout(settled.resolve, 0);
    await settled.promise;
  });
}

beforeEach(() => {
  browsing = "overwatch";
  listRanks.mockReset();
  listRanks.mockResolvedValue({ page: 1, per_page: 30, total: 1, results: [row()] });
  listAuthors.mockReset();
  listAuthors.mockResolvedValue({ authors: [] });
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  container.remove();
  // The chip picker's popover is portalled to `body`.
  document.body.innerHTML = "";
});

async function click(element: Element | null | undefined) {
  await act(async () => {
    element?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

describe("rank overview table", () => {
  it("links the player to their person page", async () => {
    await render("");

    const headers = [...container.querySelectorAll("th")].map((cell) => cell.textContent);
    expect(headers).toContain("columns.player");
    expect(container.querySelector('a[href="/admin/people/42"]')).not.toBeNull();
  });

  it("sends the URL's division range as tier numbers, leaving the rank mapping to the server", async () => {
    await render("?div_min=2&div_max=3");

    expect(lastParams()).toMatchObject({ divMin: 2, divMax: 3 });
  });

  it("writes a range picked in the division picker to the URL as div_min/div_max", async () => {
    await render("");
    expect(lastParams().divMin).toBeUndefined();

    await click(container.querySelector('button[aria-label^="filters.divisions"]'));
    await click(document.querySelector('button[aria-label="Gold"]'));
    await click(document.querySelector('button[aria-label="Silver"]'));

    const search = new URLSearchParams(window.location.search);
    expect([search.get("div_min"), search.get("div_max")]).toEqual(["2", "3"]);
  });

  it("passes the layer, author and canon-diff filters the URL carries", async () => {
    await render("?layer=author,native&author=5,8&role=tank&differs=1&date_from=2026-01-01");

    expect(lastParams()).toMatchObject({
      layer: ["author", "native"],
      authorUserId: [5, 8],
      role: ["tank"],
      differsFromCanon: true,
      dateFrom: "2026-01-01"
    });
  });

  it("reads the browsing game's ranks with its own discipline, never an implied one", async () => {
    browsing = "lol";
    await render("");

    expect(lastParams().discipline).toBe("lol");
  });

  it("shows a League role as its own glyph and keeps a role the dictionary does not know as its code", async () => {
    browsing = "lol";
    listRanks.mockResolvedValue({
      page: 1,
      per_page: 30,
      total: 2,
      // A League read returns League rows: each row's role is drawn from its own game's dictionary.
      results: [row({ discipline: "lol", role: "jungle" }), row({ discipline: "lol", member_id: 10, role: "tank" })]
    });
    await render("");

    // The i18n mock echoes keys, so a known role's glyph is titled by its code.
    expect(container.querySelector('[role="img"][title="jungle"]')).not.toBeNull();
    // OW's `tank` is not a League position: no glyph, the raw code.
    expect(container.querySelector('[role="img"][title="tank"]')).toBeNull();
    expect(container.textContent).toContain("tank");
  });

  it("leads the bar with the game chip; a game picked there drops the role, division range and rank order", async () => {
    await render("?discipline=overwatch&role=tank&div_min=1&div_max=2&layer=author&sort=rank_value&dir=desc");

    // The i18n mock echoes keys: the picker trigger is `addFilter`, the game chip `column`.
    await click(container.querySelector('button[aria-label="addFilter"]'));
    const gameItem = document.querySelector('[cmdk-item=""]');
    expect(gameItem?.textContent).toBe("column");
    await click(gameItem);
    await click([...document.querySelectorAll('[cmdk-item=""]')].find((item) => item.textContent?.includes("League of Legends")));

    const search = new URLSearchParams(window.location.search);
    expect(search.get("discipline")).toBe("lol");
    for (const param of ["role", "div_min", "div_max", "sort", "dir"]) expect(search.has(param), param).toBe(false);
    expect(search.get("layer")).toBe("author");
  });
});
