// @vitest-environment happy-dom
//
// The admin tournaments list is a multi page (spec §6.9): every game's tournaments under "all games", with an "Игра"
// column; under a game the server filters and the column is gone.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NextIntlClientProvider } from "next-intl";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import en from "@/i18n/messages/en.json";
import { useWorkspaceStore } from "@/stores/workspace.store";
import { navigation } from "@/test/url-navigation";
import type { Tournament } from "@/types/tournament.types";

import { TournamentsBrowser } from "./TournamentsBrowser";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

const { getAll } = vi.hoisted(() => ({ getAll: vi.fn() }));

vi.mock("next/navigation", async () => (await import("@/test/url-navigation")).nextNavigationMock);
vi.mock("@/services/discipline.service", async () => (await import("@/test/discipline-metadata")).disciplineServiceMock);
vi.mock("@/services/tournament.service", () => ({ default: { getAll } }));
vi.mock("@/services/admin.service", () => ({ default: { deleteTournament: vi.fn() } }));
vi.mock("@/hooks/usePermissions", () => ({ usePermissions: () => ({ canAccessPermission: () => true }) }));

function tournament(id: number, discipline: string, name: string): Tournament {
  return {
    id,
    name,
    discipline,
    is_league: false,
    is_hidden: false,
    is_finished: false,
    status: "registration",
    start_date: new Date("2026-02-01T00:00:00Z"),
    end_date: new Date("2026-02-08T00:00:00Z"),
    stages: []
  } as unknown as Tournament;
}

const POOL = [tournament(1, "overwatch", "Spring Cup"), tournament(2, "lol", "Rift Cup")];

let root: Root;
let container: HTMLDivElement;

async function settle() {
  for (let turn = 0; turn < 6; turn += 1) {
    await act(async () => {
      const { promise, resolve } = Promise.withResolvers<void>();
      setTimeout(resolve, 0);
      await promise;
    });
  }
}

async function mount(url: string) {
  navigation.reset(url);
  await act(async () => {
    root.render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <NextIntlClientProvider locale="en" messages={en} timeZone="UTC">
          <TournamentsBrowser />
        </NextIntlClientProvider>
      </QueryClientProvider>
    );
  });
  await settle();
}

const headers = () => [...container.querySelectorAll("th")].map((cell) => cell.textContent?.trim() ?? "");
const rowText = (name: string) =>
  [...container.querySelectorAll("tbody tr")].map((row) => row.textContent ?? "").find((text) => text.includes(name));

beforeEach(() => {
  getAll.mockReset().mockImplementation(async (_isLeague: unknown, _workspace: unknown, discipline?: string | null) => {
    const results = POOL.filter((entry) => !discipline || entry.discipline === discipline);
    return { results, total: results.length, page: 1, per_page: -1 };
  });
  useWorkspaceStore.setState({
    currentWorkspaceId: 1,
    workspaces: [{ id: 1, name: "OWT", disciplines_enabled: ["overwatch", "lol"] }] as never,
    statsScope: "workspace",
    hostLockedWorkspaceId: null,
    gameScope: "all",
    lastGame: null
  });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe("admin tournaments list across games", () => {
  it("lists every game's tournaments under all games, with a Game column naming each row's game", async () => {
    await mount("/admin/tournaments");

    expect(getAll).toHaveBeenCalledWith(null, undefined, null);
    expect(headers().some((text) => text.includes(en.common.discipline.column))).toBe(true);
    expect(rowText("Rift Cup")).toContain("League of Legends");
    expect(rowText("Spring Cup")).toContain("Overwatch");
  });

  it("asks the server for one game's tournaments under a game, without the column", async () => {
    await mount("/admin/tournaments?discipline=lol");

    expect(getAll).toHaveBeenLastCalledWith(null, undefined, "lol");
    expect(headers().some((text) => text.includes(en.common.discipline.column))).toBe(false);
    expect(rowText("Rift Cup")).toBeDefined();
    expect(rowText("Spring Cup")).toBeUndefined();
  });

  it("reads nothing for an unknown game and leaves its URL as typed, then lists every game on request", async () => {
    await mount("/admin/tournaments?discipline=starcraft");

    expect(getAll).not.toHaveBeenCalled();
    expect(navigation.current()).toBe("/admin/tournaments?discipline=starcraft");

    const showAll = [...container.querySelectorAll("button")].find(
      (button) => button.textContent?.trim() === en.common.discipline.showAll
    );
    await act(async () => showAll?.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    await settle();

    expect(navigation.current()).toBe("/admin/tournaments");
    expect(getAll).toHaveBeenCalledWith(null, undefined, null);
    expect(rowText("Rift Cup")).toContain("League of Legends");
  });
});
