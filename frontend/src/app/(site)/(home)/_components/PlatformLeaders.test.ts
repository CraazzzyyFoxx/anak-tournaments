// @vitest-environment happy-dom
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createTranslator, NextIntlClientProvider } from "next-intl";
import { beforeEach, expect, it, vi } from "vitest";

import messages from "@/i18n/messages/en.json";
import { formatterFor } from "@/lib/datetime/formatter";
import type { PageGameResolution } from "@/lib/site/discipline-scope";
import { multiResolution } from "@/test/game-scope";
import { PlatformLeaders } from "./PlatformLeaders";

vi.mock("next-intl/server", () => ({
  getTranslations: async (namespace: "home.leaders" | "site.kpi") =>
    createTranslator({ locale: "en", messages, namespace })
}));
vi.mock("@/lib/datetime/server", () => ({
  getFormatter: async () => formatterFor("en", "UTC")
}));
const scope = vi.hoisted(() => ({
  resolution: null as PageGameResolution | null,
  calls: [] as unknown[][],
  champions: [] as unknown[][]
}));
vi.mock("@/lib/site/discipline-server", () => ({
  resolveServerPageGame: async (...args: unknown[]) => {
    scope.calls.push(args);
    return { init: null, resolution: scope.resolution };
  }
}));
// The invalid/empty notice is the shared client component's own concern.
vi.mock("@/components/workspace/ServerGameScopeNotice", () => ({
  ServerGameScopeNotice: () => "[game notice]"
}));
vi.mock("./home-data", () => ({
  getPublicWorkspaces: async () => [{ id: 1 }, { id: 2 }]
}));
vi.mock("@/services/statistics.service", () => ({
  default: {
    // Older API responses can omit extended aggregates. Zero is still real data.
    getOverallStatistics: async () => ({
      tournaments: 0,
      players: 1450,
      teams: 1738,
      champions: 229,
      encounters: 0,
      maps: 4913,
      hours: 926
    }),
    getChampions: async (...args: unknown[]) => {
      scope.champions.push(args);
      return {
        page: 1,
        per_page: 20,
        total: 6,
        results: [
          { id: 1, name: "Askhay#21578", value: 4 },
          { id: 2, name: "ToR#22245", value: 3 },
          { id: 3, name: "Katan#21331", value: 3 },
          { id: 4, name: "MiniMe#2864", value: 3 },
          { id: 5, name: "Oikawa#21544", value: 3 },
          { id: 6, name: "ch1dan1ch#2938", value: 2 }
        ]
      };
    },
    getTopWinratePlayers: async () => ({
      page: 1,
      per_page: 20,
      total: 1,
      results: [{ id: 7, name: "Zuuuuuuuuuuz#2690", value: 0.69 }]
    })
  }
}));

beforeEach(() => {
  scope.resolution = multiResolution(null);
  scope.calls = [];
  scope.champions = [];
});

async function renderLeaders(discipline?: string) {
  const root = document.createElement("div");
  root.innerHTML = renderToStaticMarkup(
    createElement(
      NextIntlClientProvider,
      { locale: "en", messages, timeZone: "UTC", now: new Date("2026-01-01T00:00:00Z") },
      await PlatformLeaders({ discipline })
    )
  );
  return root;
}

it("shows one cross-game top under all games, keeping zero counts and board boundaries", async () => {
  const root = await renderLeaders();
  const metric = (key: keyof typeof messages.site.kpi) =>
    Array.from(root.querySelectorAll("dl > div"))
      .find((row) => row.querySelector("dt")?.textContent === messages.site.kpi[key])
      ?.querySelector("dd")?.textContent;

  expect(scope.calls).toEqual([["multi", undefined]]);
  expect(scope.champions[0]?.[0]).toBeNull();
  expect(metric("tournaments")).toBe("0");
  expect(metric("encounters")).toBe("0");
  expect(metric("days")).toBeUndefined();
  expect(metric("communities")).toBe("2");
  expect(root.querySelector('a[href="/users/Askhay-21578"]')?.textContent).toContain("4×");
  expect(root.querySelector('a[href="/users/Zuuuuuuuuuuz-2690"]')?.textContent).toContain("69.0%");
  expect(root.querySelector('a[href="/users/Oikawa-21544"]')).not.toBeNull();
  expect(root.querySelector('a[href="/users/ch1dan1ch-2938"]')).toBeNull();
});

it("reads the game's own boards when the page is on one game", async () => {
  scope.resolution = multiResolution("lol");
  await renderLeaders("lol");

  expect(scope.calls).toEqual([["multi", "lol"]]);
  expect(scope.champions[0]?.[0]).toBe("lol");
});

it("shows the notice for an invalid explicit game and reads no board", async () => {
  scope.resolution = {
    game: { kind: "invalid", requested: "chess", reason: "unknown" },
    pill: { kind: "all" },
    tabs: false,
    scope: "all"
  };
  const root = await renderLeaders("chess");

  expect(scope.champions).toEqual([]);
  expect(root.textContent).toContain("[game notice]");
  expect(root.textContent).toContain(messages.site.kpi.players);
});

it("keeps the game-neutral totals when the games could not be read", async () => {
  scope.resolution = null;
  const root = await renderLeaders();

  expect(scope.champions).toEqual([]);
  expect(root.querySelector('a[href="/users/Askhay-21578"]')).toBeNull();
  expect(root.textContent).toContain(messages.site.kpi.players);
});
