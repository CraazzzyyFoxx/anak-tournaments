// @vitest-environment happy-dom
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createTranslator, NextIntlClientProvider } from "next-intl";
import { beforeEach, expect, it, vi } from "vitest";

import messages from "@/i18n/messages/en.json";
import { formatterFor } from "@/lib/datetime/formatter";
import type { PageGame } from "@/lib/site/discipline-scope";
import type { Workspace } from "@/types/workspace.types";
import { HallOfFame } from "./HallOfFame";

vi.mock("next-intl/server", () => ({
  getTranslations: async (namespace: string) =>
    createTranslator({ locale: "en", messages, namespace: namespace as never })
}));
vi.mock("@/lib/datetime/server", () => ({
  getFormatter: async () => formatterFor("en", "UTC")
}));
const reads = vi.hoisted(() => ({ champions: [] as unknown[][] }));
vi.mock("@/services/statistics.service", () => ({
  default: {
    getOverallStatistics: async () => ({
      tournaments: 3,
      players: 40,
      teams: 8,
      champions: 5,
      encounters: 12,
      maps: 30,
      hours: 9
    }),
    getChampions: async (...args: unknown[]) => {
      reads.champions.push(args);
      return { page: 1, per_page: 20, total: 1, results: [{ id: 1, name: "Askhay#21578", value: 4 }] };
    },
    getTopWinratePlayers: async () => ({ page: 1, per_page: 20, total: 0, results: [] })
  }
}));

const WORKSPACE = { id: 5 } as Workspace;

beforeEach(() => {
  reads.champions = [];
});

async function render(game: PageGame | null) {
  const root = document.createElement("div");
  root.innerHTML = renderToStaticMarkup(
    createElement(
      NextIntlClientProvider,
      { locale: "en", messages, timeZone: "UTC", now: new Date("2026-01-01T00:00:00Z") },
      await HallOfFame({ workspace: WORKSPACE, game })
    )
  );
  return root;
}

it("reads one cross-game top of the community under all games", async () => {
  const root = await render({ kind: "all" });

  expect(reads.champions).toEqual([[null, { workspaceId: 5 }]]);
  expect(root.querySelector('a[href="/users/Askhay-21578"]')?.textContent).toContain("4×");
});

it("reads the game's own top when the page is on one game", async () => {
  await render({ kind: "game", code: "lol", source: "scope" });

  expect(reads.champions).toEqual([["lol", { workspaceId: 5 }]]);
});

it("reads no leaders for an invalid game but keeps the community's totals", async () => {
  const root = await render({ kind: "invalid", requested: "chess", reason: "unknown" });

  expect(reads.champions).toEqual([]);
  expect(root.querySelector('a[href="/users/Askhay-21578"]')).toBeNull();
  expect(root.textContent).toContain(messages.site.kpi.players);
});
