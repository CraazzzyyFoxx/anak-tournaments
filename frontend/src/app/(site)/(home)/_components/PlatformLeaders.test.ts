// @vitest-environment happy-dom
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createTranslator, NextIntlClientProvider } from "next-intl";
import { beforeEach, expect, it, vi } from "vitest";

import messages from "@/i18n/messages/en.json";
import { formatterFor } from "@/lib/datetime/formatter";
import { PlatformLeaders } from "./PlatformLeaders";

vi.mock("next-intl/server", () => ({
  getTranslations: async (namespace: "home.leaders" | "site.kpi") =>
    createTranslator({ locale: "en", messages, namespace })
}));
vi.mock("@/lib/datetime/server", () => ({
  getFormatter: async () => formatterFor("en", "UTC")
}));
const browsing = vi.hoisted(() => ({
  resolved: { kind: "concrete", code: "overwatch", source: "default" } as Record<string, string> | null,
  explicit: [] as unknown[],
  champions: [] as unknown[][]
}));
vi.mock("@/lib/site/discipline-server", () => ({
  resolveServerBrowsingDiscipline: async (explicit: unknown) => {
    browsing.explicit.push(explicit);
    return { init: null, resolved: browsing.resolved };
  }
}));
// The client game control (selector, or the named invalid value) is the shared component's own concern.
vi.mock("@/components/workspace/ServerBrowsingDiscipline", () => ({
  ServerBrowsingDiscipline: () => "[game control]"
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
      browsing.champions.push(args);
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
  browsing.resolved = { kind: "concrete", code: "overwatch", source: "default" };
  browsing.explicit = [];
  browsing.champions = [];
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

it("preserves zero counts and leaderboard boundaries with incomplete API totals", async () => {
  const root = await renderLeaders();
  const metric = (key: keyof typeof messages.site.kpi) =>
    Array.from(root.querySelectorAll("dl > div"))
      .find((row) => row.querySelector("dt")?.textContent === messages.site.kpi[key])
      ?.querySelector("dd")?.textContent;

  expect(metric("tournaments")).toBe("0");
  expect(metric("encounters")).toBe("0");
  expect(metric("days")).toBeUndefined();
  expect(metric("communities")).toBe("2");
  expect(root.querySelector('a[href="/users/Askhay-21578"]')?.textContent).toContain("4×");
  expect(root.querySelector('a[href="/users/Zuuuuuuuuuuz-2690"]')?.textContent).toContain("69.0%");
  expect(root.querySelector('a[href="/users/Oikawa-21544"]')).not.toBeNull();
  expect(root.querySelector('a[href="/users/ch1dan1ch-2938"]')).toBeNull();
  // The leaderboards are the browsing game's.
  expect(browsing.champions[0]?.[0]).toBe("overwatch");
});

it("reads no leaderboard without a resolved game, keeping the game-neutral totals", async () => {
  browsing.resolved = null;
  const root = await renderLeaders();

  expect(browsing.champions).toEqual([]);
  expect(root.querySelector('a[href="/users/Askhay-21578"]')).toBeNull();
  expect(root.textContent).toContain(messages.site.kpi.players);
});

it("reads the explicitly requested game's leaderboards", async () => {
  browsing.resolved = { kind: "concrete", code: "lol", source: "url" };
  const root = await renderLeaders("lol");

  expect(browsing.explicit).toEqual(["lol"]);
  expect(browsing.champions[0]?.[0]).toBe("lol");
  expect(root.textContent).toContain("[game control]");
});

it("shows the game control for an invalid explicit game and reads no leaderboard", async () => {
  browsing.resolved = { kind: "invalid", requested: "chess", reason: "unknown" };
  const root = await renderLeaders("chess");

  expect(browsing.explicit).toEqual(["chess"]);
  expect(browsing.champions).toEqual([]);
  expect(root.textContent).toContain("[game control]");
  expect(root.textContent).toContain(messages.site.kpi.players);
});
