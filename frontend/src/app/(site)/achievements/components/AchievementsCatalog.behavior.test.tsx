// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import en from "@/i18n/messages/en.json";
import { navigation } from "@/test/url-navigation";
import { useWorkspaceStore } from "@/stores/workspace.store";
import type { Workspace } from "@/types/workspace.types";

import AchievementsCatalogPage from "./AchievementsCatalog";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  getAll: vi.fn(),
  list: vi.fn(),
}));

vi.mock("next-intl", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next-intl")>();
  const { default: messages } = await import("@/i18n/messages/en.json");
  return {
    ...actual,
    useTranslations: (namespace?: string) =>
      actual.createTranslator({ locale: "en", messages, namespace: namespace as never }),
  };
});
vi.mock("next/navigation", async () => (await import("@/test/url-navigation")).nextNavigationMock);
vi.mock("@/services/achievements.service", () => ({ default: { getAll: mocks.getAll } }));
vi.mock("@/services/discipline.service", () => ({ default: { list: mocks.list } }));
vi.mock("./AchievementsHero", () => ({ default: () => null }));
// `data-marked` is whether the catalogue asked the tile to name its game.
vi.mock("./AchievementTile", () => ({
  default: ({ achievement, games }: { achievement: { id: number; discipline: string }; games?: Map<string, unknown> }) => (
    <i data-tile={achievement.id} data-game={achievement.discipline} data-marked={games ? "yes" : "no"} />
  ),
}));
vi.mock("@/components/achievements/RarityStrip", () => ({ RarityStrip: () => null }));

function workspace(id: number, disciplines: string[]): Workspace {
  return { id, slug: `w${id}`, name: `w${id}`, disciplines_enabled: disciplines } as Workspace;
}

const GAMES = [
  { code: "overwatch", name: "Overwatch", short_name: "OW", icon: null, enabled: true },
  { code: "lol", name: "League of Legends", short_name: "LoL", icon: null, enabled: true },
];

const RULES: Record<string, { id: number; name: string; discipline: string; rarity: number; count: number; category: string }> = {
  overwatch: { id: 1, name: "OW", discipline: "overwatch", rarity: 0.1, count: 2, category: "overall" },
  lol: { id: 2, name: "LoL", discipline: "lol", rarity: 0.2, count: 1, category: "overall" },
};

let root: Root;
let container: HTMLElement;

// The chain list → resolve → read → render needs several turns; one wait is not enough.
const tick = async () => {
  for (let turn = 0; turn < 3; turn++) {
    const { promise, resolve } = Promise.withResolvers<void>();
    setTimeout(resolve, 10);
    await act(() => promise);
  }
};

async function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => {
    root.render(
      <QueryClientProvider client={client}>
        <AchievementsCatalogPage />
      </QueryClientProvider>
    );
  });
  await tick();
}

const tiles = () => [...container.querySelectorAll("[data-tile]")].map((tile) => tile.getAttribute("data-game"));
const marks = () => [...container.querySelectorAll("[data-tile]")].map((tile) => tile.getAttribute("data-marked"));

beforeEach(() => {
  mocks.getAll
    .mockReset()
    .mockImplementation(async (_page: number, _per: number, _scope: unknown, game: string | null) => {
      const results = game === null ? [RULES.overwatch, RULES.lol] : [RULES[game]];
      return { results, total: results.length };
    });
  mocks.list.mockReset().mockResolvedValue(GAMES);
  navigation.reset("/achievements");
  document.body.innerHTML = "";
  document.cookie = "owt-discipline=; Max-Age=0; path=/";
  container = document.body.appendChild(document.createElement("div"));
  root = createRoot(container);
  useWorkspaceStore.setState({
    workspaces: [workspace(1, ["overwatch"]), workspace(2, ["overwatch", "lol"])],
    currentWorkspaceId: 1,
    statsScope: "all",
    hostLockedWorkspaceId: null,
    gameScope: "all",
    lastGame: null,
  });
});

afterEach(async () => {
  await act(async () => root.unmount());
});

describe("the public achievement catalogue", () => {
  it("lists every game's rules under all games, marks each tile, and writes nothing to the URL", async () => {
    await mount();

    expect(mocks.list).toHaveBeenCalledWith("all", expect.anything());
    expect(mocks.getAll).toHaveBeenCalledTimes(1);
    expect(mocks.getAll).toHaveBeenCalledWith(1, -1, "all", null, expect.anything());
    expect(tiles().sort()).toEqual(["lol", "overwatch"]);
    expect(marks()).toEqual(["yes", "yes"]);
    expect(navigation.replaces).toEqual([]);
    expect(navigation.pushes).toEqual([]);
  });

  it("asks for the explicit game and shows only its rules, unmarked", async () => {
    navigation.reset("/achievements?discipline=lol");
    await mount();

    expect(mocks.getAll).toHaveBeenCalledWith(1, -1, "all", "lol", expect.anything());
    expect(tiles()).toEqual(["lol"]);
    expect(marks()).toEqual(["no"]);
    expect(navigation.replaces).toEqual([]);
  });

  it("narrows to the saved game scope when the URL names none, and the URL wins over it without changing it", async () => {
    useWorkspaceStore.setState({ gameScope: "lol" });
    await mount();
    expect(mocks.getAll).toHaveBeenCalledWith(1, -1, "all", "lol", expect.anything());

    await act(async () => root.unmount());
    root = createRoot(container);
    mocks.getAll.mockClear();
    navigation.reset("/achievements?discipline=overwatch");
    await mount();
    expect(mocks.getAll).toHaveBeenCalledWith(1, -1, "all", "overwatch", expect.anything());
    expect(useWorkspaceStore.getState().gameScope).toBe("lol");
  });

  it("reads an old ?discipline=all link as no parameter: every game", async () => {
    navigation.reset("/achievements?discipline=all");
    await mount();

    expect(mocks.getAll).toHaveBeenCalledWith(1, -1, "all", null, expect.anything());
    expect(tiles().sort()).toEqual(["lol", "overwatch"]);
    expect(navigation.current()).toBe("/achievements?discipline=all");
  });

  it("names an unknown game, reads nothing and leaves the URL alone, then widens to every game on request", async () => {
    navigation.reset("/achievements?discipline=starcraft");
    await mount();

    expect(container.textContent).toContain('"starcraft" is not an installed game.');
    expect(mocks.getAll).not.toHaveBeenCalled();
    expect(navigation.current()).toBe("/achievements?discipline=starcraft");

    const showAll = [...container.querySelectorAll("button")].find(
      (button) => button.textContent?.trim() === en.common.discipline.showAll
    );
    await act(async () => showAll?.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    await tick();

    expect(new URL(navigation.current(), "http://x").searchParams.has("discipline")).toBe(false);
    expect(tiles().sort()).toEqual(["lol", "overwatch"]);
  });

  it("scopes the read to the viewed workspace", async () => {
    useWorkspaceStore.setState({ statsScope: "workspace", currentWorkspaceId: 2 });
    await mount();

    expect(mocks.list).toHaveBeenCalledWith(2, expect.anything());
    expect(mocks.getAll).toHaveBeenCalledWith(1, -1, 2, null, expect.anything());
  });

  it("no longer reads the removed ?game= parameter", async () => {
    navigation.reset("/achievements?game=lol");
    await mount();

    expect(mocks.getAll).toHaveBeenCalledWith(1, -1, "all", null, expect.anything());
    expect(tiles().sort()).toEqual(["lol", "overwatch"]);
  });

  it("drops the previous game's rules the moment the game changes and ignores its late response", async () => {
    const overwatch = Promise.withResolvers<{ results: unknown[]; total: number }>();
    let overwatchSignal: AbortSignal | undefined;
    mocks.getAll.mockImplementation(
      (_page: number, _per: number, _scope: unknown, game: string | null, opts: { signal: AbortSignal }) => {
        if (game === "overwatch") {
          overwatchSignal = opts.signal;
          return overwatch.promise;
        }
        return Promise.resolve({ results: [RULES.lol], total: 1 });
      }
    );
    navigation.reset("/achievements?discipline=overwatch");
    await mount();
    expect(tiles()).toEqual([]); // still pending

    // The page is a skeleton while loading, so the game changes from outside it: the pill or the address bar.
    await act(async () => navigation.push("/achievements?discipline=lol"));
    await tick();
    expect(tiles()).toEqual(["lol"]);
    expect(overwatchSignal?.aborted).toBe(true);

    await act(async () => overwatch.resolve({ results: [RULES.overwatch], total: 1 }));
    await tick();
    expect(tiles()).toEqual(["lol"]);
  });
});
