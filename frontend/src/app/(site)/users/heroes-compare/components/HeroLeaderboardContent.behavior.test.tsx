// @vitest-environment happy-dom
//
// A catalog id in the URL must belong to the scoped game (P7 §3.4): `?hero_id=<Overwatch id>&discipline=lol`
// is a conflicting selection to name, not an Overwatch hero to relabel or rank.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import messages from "@/i18n/messages/en.json";
import { ApiError } from "@/lib/api/error";
import { useWorkspaceStore } from "@/stores/workspace.store";
import { catalogEntity } from "@/test/catalog";
import { navigation } from "@/test/url-navigation";

import HeroLeaderboardContent from "./HeroLeaderboardContent";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  getEntity: vi.fn(),
  listEntities: vi.fn(),
  leaderboard: vi.fn()
}));

vi.mock("next/navigation", async () => (await import("@/test/url-navigation")).nextNavigationMock);
vi.mock("@/services/discipline.service", () => ({
  default: {
    list: async () => [
      { code: "overwatch", name: "Overwatch", enabled: true, kinds: { character: "Hero", map: "Map", mode: "Mode" } },
      { code: "lol", name: "League of Legends", enabled: true, kinds: { character: "Champion", map: "Map" } }
    ]
  }
}));
vi.mock("@/services/catalog.service", () => ({
  default: {
    get: (...args: unknown[]) => mocks.getEntity(...args),
    list: (...args: unknown[]) => mocks.listEntities(...args)
  }
}));
vi.mock("@/services/hero.service", () => ({
  default: { getHeroLeaderboard: (...args: unknown[]) => mocks.leaderboard(...args) }
}));
vi.mock("@/services/tournament.service", () => ({
  default: { getAll: async () => ({ results: [], total: 0, page: 1, per_page: -1 }) }
}));

let root: Root;
let container: HTMLDivElement;

async function settle(turns = 8) {
  for (let turn = 0; turn < turns; turn += 1) {
    await act(async () => {
      const { promise, resolve } = Promise.withResolvers<void>();
      setTimeout(resolve, 0);
      await promise;
    });
  }
}

async function mount(url: string) {
  navigation.reset(url);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <QueryClientProvider client={client}>
          <HeroLeaderboardContent scope="all" />
        </QueryClientProvider>
      </NextIntlClientProvider>
    );
  });
  await settle();
}

beforeEach(() => {
  useWorkspaceStore.setState({ browsingDiscipline: null, hostLockedWorkspaceId: null, currentWorkspaceId: null });
  mocks.getEntity.mockReset();
  mocks.listEntities.mockReset().mockResolvedValue({ results: [], total: 0, page: 1, per_page: -1 });
  mocks.leaderboard.mockReset().mockResolvedValue({ results: [], total: 0, page: 1, per_page: -1 });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe("hero leaderboard selection", () => {
  it("names a hero that is not in the scoped game and requests no statistics for it", async () => {
    mocks.getEntity.mockRejectedValue(new ApiError(404, [{ msg: "not found" }]));

    await mount("/users/heroes-compare?hero_id=7&discipline=lol");

    expect(mocks.getEntity.mock.calls[0]?.slice(0, 3)).toEqual(["lol", "character", 7]);
    expect(container.textContent).toContain("That hero is not in this game");
    expect(container.textContent).toContain("League of Legends");
    expect(mocks.leaderboard).not.toHaveBeenCalled();
  });

  it("ranks a hero that belongs to the scoped game", async () => {
    mocks.getEntity.mockResolvedValue(catalogEntity({ id: 7, name: "Ana", attrs: { class: "support" } }));

    await mount("/users/heroes-compare?hero_id=7&discipline=overwatch");

    expect(mocks.leaderboard).toHaveBeenCalledTimes(1);
    expect(mocks.leaderboard.mock.calls[0]?.[0]).toBe(7);
    expect(container.textContent).not.toContain("That hero is not in this game");
  });

  it("asks for nothing while the id has not been checked yet", async () => {
    mocks.getEntity.mockReturnValue(new Promise(() => undefined));

    await mount("/users/heroes-compare?hero_id=7&discipline=overwatch");

    expect(mocks.leaderboard).not.toHaveBeenCalled();
  });
});
