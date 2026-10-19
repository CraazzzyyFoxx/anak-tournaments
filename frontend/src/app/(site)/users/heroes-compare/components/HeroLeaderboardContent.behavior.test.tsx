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
// Real installed-game fixtures (descriptors + metadata): the comparison slots resolve the browsed game's module.
vi.mock("@/services/discipline.service", async () => (await import("@/test/discipline-metadata")).disciplineServiceMock);
vi.mock("@/services/catalog.service", () => ({
  default: {
    get: (...args: unknown[]) => mocks.getEntity(...args),
    list: (...args: unknown[]) => mocks.listEntities(...args)
  }
}));
vi.mock("@/services/statistics.service", () => ({
  default: { getCharacterLeaderboard: (...args: unknown[]) => mocks.leaderboard(...args) }
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

/** Lets the browsed game's lazily loaded comparison module mount: settles until `done` holds (bounded). */
async function settleUntil(done: () => boolean, deadline = Date.now() + 4000) {
  while (!done() && Date.now() < deadline) await settle(1);
}

let client: QueryClient;

async function mount(url: string, keepClient = false) {
  navigation.reset(url);
  if (!keepClient) client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 60_000 } } });
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
  useWorkspaceStore.setState({ gameScope: "all", hostLockedWorkspaceId: null, currentWorkspaceId: null });
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
    await settleUntil(
      () =>
        container.textContent!.includes(messages.users.heroesCompare.hero.bestKd) &&
        container.textContent!.includes(messages.users.heroesCompare.allTournaments)
    );

    expect(mocks.leaderboard).toHaveBeenCalledTimes(1);
    // The scoped game's statistics route, for the checked entity.
    expect(mocks.leaderboard.mock.calls[0]?.slice(0, 2)).toEqual(["overwatch", 7]);
    expect(container.textContent).not.toContain("That hero is not in this game");
    // Overwatch's module draws the board and its headline figures.
    expect(container.textContent).toContain(messages.users.heroesCompare.hero.bestKd);
  });

  it("tells a game without a comparison renderer so, with no Overwatch figures and no read", async () => {
    mocks.getEntity.mockResolvedValue(catalogEntity({ id: 9, discipline: "lol", name: "Ahri", attrs: { class: "support" } }));

    await mount("/users/heroes-compare?hero_id=9&discipline=lol");

    expect(container.textContent).toContain(messages.common.discipline.widgetUnsupported);
    expect(container.textContent).not.toContain(messages.users.heroesCompare.hero.bestKd);
    expect(mocks.leaderboard).not.toHaveBeenCalled();
  });

  it("asks for nothing while the id has not been checked yet", async () => {
    mocks.getEntity.mockReturnValue(new Promise(() => undefined));

    await mount("/users/heroes-compare?hero_id=7&discipline=overwatch");

    expect(mocks.leaderboard).not.toHaveBeenCalled();
  });

  describe("another game's cached results", () => {
    const OW_ROW = {
      rank: 1, user_id: 1, username: "ow-ranked", player_name: "ow-ranked", role: null, div: 1, team: null, team_id: null,
      games_played: 3, playtime_seconds: 900, per10_eliminations: 10, per10_healing: 0, per10_deaths: 4,
      per10_damage: 1, per10_final_blows: 1, per10_damage_blocked: 0, per10_solo_kills: 0, per10_obj_kills: 0,
      per10_defensive_assists: 0, per10_offensive_assists: 0, per10_all_damage: 1, per10_damage_taken: 1,
      per10_self_healing: 0, per10_ultimates_used: 0, per10_multikills: 0, per10_env_kills: 0, per10_crit_hits: 0,
      avg_weapon_accuracy: 0.5, avg_crit_accuracy: 0.1, kd: 2, kda: 3
    };

    async function showOverwatchResults() {
      mocks.getEntity.mockResolvedValue(catalogEntity({ id: 7, name: "Ana", attrs: { class: "support" } }));
      mocks.leaderboard.mockResolvedValue({ results: [OW_ROW], total: 1, page: 1, per_page: -1 });
      await mount("/users/heroes-compare?hero_id=7&discipline=overwatch");
      await settleUntil(() => container.textContent!.includes("ow-ranked"));
      expect(container.textContent).toContain("ow-ranked");
    }

    async function switchToLol() {
      await act(async () => {
        navigation.push("/users/heroes-compare?hero_id=7&discipline=lol");
      });
      await settle();
    }

    it("shows none of it while the scoped lookup is pending, and none after it 404s", async () => {
      await showOverwatchResults();
      let reject!: (error: unknown) => void;
      mocks.getEntity.mockReturnValue(new Promise((_, fail) => (reject = fail)));

      await switchToLol();
      expect(container.textContent).not.toContain("ow-ranked");

      await act(async () => reject(new ApiError(404, [{ msg: "not found" }])));
      await settle();
      expect(container.textContent).not.toContain("ow-ranked");
      expect(container.textContent).toContain("That hero is not in this game");
    });

    it("withholds results on a failed lookup, says so, and retries on request", async () => {
      await showOverwatchResults();
      mocks.getEntity.mockRejectedValue(new Error("boom"));

      await switchToLol();
      expect(container.textContent).not.toContain("ow-ranked");
      expect(container.textContent).toContain("Could not check that hero");

      const callsBefore = mocks.getEntity.mock.calls.length;
      mocks.getEntity.mockResolvedValue(catalogEntity({ id: 7, discipline: "lol", name: "Ana" }));
      const retry = Array.from(container.querySelectorAll("button")).find((button) => button.textContent?.trim() === "Retry");
      expect(retry).toBeTruthy();
      await act(async () => retry!.click());
      await settle();
      expect(mocks.getEntity.mock.calls.length).toBeGreaterThan(callsBefore);
      expect(container.textContent).not.toContain("Could not check that hero");
    });
  });
});
