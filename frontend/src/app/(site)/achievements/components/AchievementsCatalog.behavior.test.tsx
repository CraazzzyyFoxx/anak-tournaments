// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
  const { default: en } = await import("@/i18n/messages/en.json");
  return { ...actual, useTranslations: (namespace?: string) => actual.createTranslator({ locale: "en", messages: en, namespace: namespace as never }) };
});
vi.mock("next/navigation", async () => (await import("@/test/url-navigation")).nextNavigationMock);
vi.mock("@/services/achievements.service", () => ({ default: { getAll: mocks.getAll } }));
vi.mock("@/services/discipline.service", () => ({ default: { list: mocks.list } }));
vi.mock("./AchievementsHero", () => ({ default: () => null }));
vi.mock("./AchievementTile", () => ({
  default: ({ achievement }: { achievement: { id: number; discipline: string } }) => (
    <i data-tile={achievement.id} data-game={achievement.discipline} />
  ),
}));
vi.mock("@/components/achievements/RarityStrip", () => ({ RarityStrip: () => null }));
vi.mock("@/components/workspace/DisciplineSelector", () => ({
  DisciplineSelector: ({
    disciplines,
    value,
    onSelect,
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
  ),
  DisciplineUnavailable: ({ resolved }: { resolved: { kind: string; requested?: string } }) => (
    <p role="alert" data-unavailable={resolved.kind}>
      {resolved.requested}
    </p>
  ),
}));

function workspace(id: number, disciplines: string[]): Workspace {
  return { id, slug: `w${id}`, name: `w${id}`, disciplines_enabled: disciplines } as Workspace;
}

const GAMES = [
  { code: "overwatch", name: "Overwatch", enabled: true },
  { code: "lol", name: "League of Legends", enabled: true },
];

const RULES: Record<string, { id: number; name: string; discipline: string; rarity: number; count: number; category: string }> = {
  overwatch: { id: 1, name: "OW", discipline: "overwatch", rarity: 0.1, count: 2, category: "overall" },
  lol: { id: 2, name: "LoL", discipline: "lol", rarity: 0.2, count: 1, category: "overall" },
};

let root: Root;
let container: HTMLElement;

// The chain list → resolve → canonical URL → read → render needs several turns; one wait is not enough.
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
const pick = (code: string) =>
  act(async () => {
    container.querySelector(`[data-pick=${code}]`)?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });

beforeEach(() => {
  mocks.getAll.mockReset().mockImplementation(async (_page: number, _per: number, _scope: unknown, game: string) => ({
    results: [RULES[game]],
    total: 1,
  }));
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
    browsingDiscipline: null,
  });
});

afterEach(async () => {
  await act(async () => root.unmount());
});

describe("the public achievement catalogue is one game at a time", () => {
  it("reads the first enabled game when nothing is chosen and writes it to the URL without a history entry", async () => {
    await mount();

    expect(mocks.list).toHaveBeenCalledWith("all", expect.anything());
    expect(mocks.getAll).toHaveBeenCalledTimes(1);
    expect(mocks.getAll).toHaveBeenCalledWith(1, -1, "all", "overwatch", expect.anything());
    expect(tiles()).toEqual(["overwatch"]);
    expect(navigation.replaces).toEqual(["/achievements?discipline=overwatch"]);
    expect(navigation.pushes).toEqual([]);
  });

  it("asks for the explicit game and shows only its rules", async () => {
    navigation.reset("/achievements?discipline=lol");
    await mount();

    expect(mocks.getAll).toHaveBeenCalledWith(1, -1, "all", "lol", expect.anything());
    expect(tiles()).toEqual(["lol"]);
    expect(container.querySelector("[data-selector]")?.getAttribute("data-selector")).toBe("lol");
    expect(navigation.replaces).toEqual([]);
  });

  it("prefers the saved game when the URL names none, but never over the URL", async () => {
    useWorkspaceStore.setState({ browsingDiscipline: "lol" });
    await mount();
    expect(mocks.getAll).toHaveBeenCalledWith(1, -1, "all", "lol", expect.anything());

    await act(async () => root.unmount());
    root = createRoot(container);
    mocks.getAll.mockClear();
    navigation.reset("/achievements?discipline=overwatch");
    await mount();
    expect(mocks.getAll).toHaveBeenCalledWith(1, -1, "all", "overwatch", expect.anything());
    expect(useWorkspaceStore.getState().browsingDiscipline).toBe("lol");
  });

  it("no longer reads the removed ?game= parameter", async () => {
    navigation.reset("/achievements?game=lol");
    await mount();

    expect(mocks.getAll).toHaveBeenCalledWith(1, -1, "all", "overwatch", expect.anything());
    expect(tiles()).toEqual(["overwatch"]);
  });

  it("shows an explicit unusable value as an error, reads no game and leaves the URL alone", async () => {
    navigation.reset("/achievements?discipline=all");
    await mount();

    expect(container.querySelector("[data-unavailable=invalid]")?.textContent).toBe("all");
    expect(mocks.getAll).not.toHaveBeenCalled();
    expect(navigation.current()).toBe("/achievements?discipline=all");
  });

  it("scopes the read to the viewed workspace", async () => {
    useWorkspaceStore.setState({ statsScope: "workspace", currentWorkspaceId: 2 });
    await mount();

    expect(mocks.list).toHaveBeenCalledWith(2, expect.anything());
    expect(mocks.getAll).toHaveBeenCalledWith(1, -1, 2, "overwatch", expect.anything());
  });

  it("a pick pushes the shareable URL, keeps other filters, and Back returns to the previous game", async () => {
    navigation.reset("/achievements?discipline=overwatch&sort=name");
    await mount();
    await pick("lol");
    await tick();

    expect(navigation.pushes).toEqual(["/achievements?discipline=lol&sort=name"]);
    expect(tiles()).toEqual(["lol"]);

    await act(async () => navigation.back());
    await tick();
    expect(tiles()).toEqual(["overwatch"]);
  });

  it("drops the previous game's rules the moment the game changes and ignores its late response", async () => {
    const overwatch = Promise.withResolvers<{ results: unknown[]; total: number }>();
    let overwatchSignal: AbortSignal | undefined;
    mocks.getAll.mockImplementation(
      (_page: number, _per: number, _scope: unknown, game: string, opts: { signal: AbortSignal }) => {
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

    // The page is a skeleton while loading, so the game changes from outside it: a link or the address bar.
    await act(async () => navigation.push("/achievements?discipline=lol"));
    await tick();
    expect(tiles()).toEqual(["lol"]);
    expect(overwatchSignal?.aborted).toBe(true);

    await act(async () => overwatch.resolve({ results: [RULES.overwatch], total: 1 }));
    await tick();
    expect(tiles()).toEqual(["lol"]);
  });
});
