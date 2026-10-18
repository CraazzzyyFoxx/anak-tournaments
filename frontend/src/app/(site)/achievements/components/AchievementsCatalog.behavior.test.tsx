// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useWorkspaceStore } from "@/stores/workspace.store";
import type { Workspace } from "@/types/workspace.types";

import AchievementsCatalogPage from "./AchievementsCatalog";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  getAll: vi.fn(),
  setParams: vi.fn(),
  search: new URLSearchParams(),
}));

vi.mock("next-intl", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next-intl")>();
  const { default: en } = await import("@/i18n/messages/en.json");
  return { ...actual, useTranslations: () => actual.createTranslator({ locale: "en", messages: en }) };
});
vi.mock("@/services/achievements.service", () => ({ default: { getAll: mocks.getAll } }));
vi.mock("@/hooks/useQueryParams", () => ({
  useQueryParams: () => ({ searchParams: mocks.search, setParams: mocks.setParams }),
}));
vi.mock("./AchievementsHero", () => ({ default: () => null }));
vi.mock("./AchievementTile", () => ({
  default: ({ achievement }: { achievement: { id: number; discipline: string } }) => (
    <i data-tile={achievement.id} data-game={achievement.discipline} />
  ),
}));
vi.mock("@/components/achievements/RarityStrip", () => ({ RarityStrip: () => null }));

function workspace(id: number, disciplines: string[]): Workspace {
  return { id, slug: `w${id}`, name: `w${id}`, disciplines_enabled: disciplines } as Workspace;
}

const RULES = {
  overwatch: { id: 1, name: "OW", discipline: "overwatch", rarity: 0.1, count: 2, category: "overall" },
  lol: { id: 2, name: "LoL", discipline: "lol", rarity: 0.2, count: 1, category: "overall" },
};

let container: HTMLElement;

async function mount(scope: "all" | "workspace" = "all") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => {
    createRoot(container).render(
      <QueryClientProvider client={client}>
        <AchievementsCatalogPage scope={scope} />
      </QueryClientProvider>
    );
  });
  await act(() => new Promise<void>((done) => setTimeout(done, 20)));
}

const tiles = () => [...container.querySelectorAll("[data-tile]")].map((tile) => tile.getAttribute("data-game"));

beforeEach(() => {
  mocks.getAll.mockReset();
  mocks.setParams.mockReset();
  mocks.search = new URLSearchParams();
  mocks.getAll.mockImplementation(async (_page: number, _per: number, _scope: unknown, game?: string | null) => ({
    results: Object.values(RULES).filter((rule) => !game || rule.discipline === game),
    total: 0,
  }));
  document.body.innerHTML = "";
  container = document.body.appendChild(document.createElement("div"));
  useWorkspaceStore.setState({
    workspaces: [workspace(1, ["overwatch"]), workspace(2, ["overwatch", "lol"])],
    currentWorkspaceId: 1,
  });
});

describe("the public achievement catalogue's game filter", () => {
  it("lists every game's rules with no game filter and offers the games the scope holds", async () => {
    await mount("all");
    expect(mocks.getAll).toHaveBeenCalledWith(1, -1, "all", null);
    expect(tiles().sort()).toEqual(["lol", "overwatch"]);
    const chips = [...container.querySelectorAll("[role=group] button")].map((chip) => chip.textContent);
    expect(chips).toEqual(expect.arrayContaining(["All games", "Overwatch", "League of Legends"]));
  });

  it("asks the reader for the selected game and shows only its rules", async () => {
    mocks.search = new URLSearchParams("game=lol");
    await mount("all");
    expect(mocks.getAll).toHaveBeenCalledWith(1, -1, "all", "lol");
    expect(tiles()).toEqual(["lol"]);
  });

  it("writes the pick to the URL when a game chip is clicked", async () => {
    await mount("all");
    const lol = [...container.querySelectorAll("button")].find((button) => button.textContent === "League of Legends");
    await act(async () => lol?.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(mocks.setParams).toHaveBeenCalledWith({ game: "lol" });
  });

  it("ignores a game the scope does not have, and offers no filter for a one-game workspace", async () => {
    mocks.search = new URLSearchParams("game=lol");
    await mount("workspace"); // workspace 1 runs Overwatch only
    expect(mocks.getAll).toHaveBeenCalledWith(1, -1, 1, null);
    expect(container.querySelector("[role=group][aria-label='Filter by game']")).toBeNull();
  });
});
