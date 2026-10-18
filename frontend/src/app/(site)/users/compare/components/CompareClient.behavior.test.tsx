// @vitest-environment happy-dom
//
// Hero/map ids in the compare URL must belong to the scoped game (P7 §3.4). A conflicting
// `?left_hero_id=<Overwatch id>&discipline=lol` is named, and no hero comparison is requested or shown.
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

import CompareClient from "./CompareClient";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  getEntity: vi.fn(),
  listEntities: vi.fn(),
  heroCompare: vi.fn(),
  compare: vi.fn()
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
vi.mock("@/services/user.service", () => ({
  default: {
    getUserHeroCompare: (...args: unknown[]) => mocks.heroCompare(...args),
    getUserCompare: (...args: unknown[]) => mocks.compare(...args),
    search: async () => ({ results: [], total: 0 })
  }
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
          <CompareClient scope="all" />
        </QueryClientProvider>
      </NextIntlClientProvider>
    );
  });
  await settle();
}

beforeEach(() => {
  window.matchMedia ??= ((query: string) => ({
    matches: false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false
  })) as unknown as typeof window.matchMedia;
  useWorkspaceStore.setState({ browsingDiscipline: null, hostLockedWorkspaceId: null, currentWorkspaceId: null });
  mocks.getEntity.mockReset();
  mocks.listEntities.mockReset().mockResolvedValue({ results: [], total: 0, page: 1, per_page: -1 });
  mocks.heroCompare.mockReset().mockResolvedValue({ metrics: [], subject: { name: "A" }, baseline: { sample_size: 0 } });
  mocks.compare.mockReset();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

const HERO_QUERY = "user_id=5&scope=hero&left_hero_id=7";

describe("compare selection", () => {
  it("names a hero that is not in the scoped game and requests no hero comparison", async () => {
    mocks.getEntity.mockRejectedValue(new ApiError(404, [{ msg: "not found" }]));

    await mount(`/users/compare?${HERO_QUERY}&discipline=lol`);

    expect(mocks.getEntity.mock.calls.map((call) => call.slice(0, 3))).toContainEqual(["lol", "character", 7]);
    expect(container.textContent).toContain("That selection is not in this game");
    expect(container.textContent).toContain("League of Legends");
    expect(mocks.heroCompare).not.toHaveBeenCalled();
  });

  it("compares a hero that belongs to the scoped game", async () => {
    mocks.getEntity.mockResolvedValue(catalogEntity({ id: 7, name: "Ana", attrs: { class: "support" } }));

    await mount(`/users/compare?${HERO_QUERY}&discipline=overwatch`);

    expect(mocks.heroCompare).toHaveBeenCalled();
    expect(container.textContent).not.toContain("That selection is not in this game");
  });
});
