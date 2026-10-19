// @vitest-environment happy-dom
//
// The mix directory is a directory surface: it shows every game under `?discipline=all` and one game under a
// concrete choice, and the list, the scoreboard and the creation form all follow that one resolved choice.
// Pinned here: the requested game reaches the list read (and is part of its key, so a game's rows never serve
// another's), an invalid choice makes no read at all, and creating a mix names its game.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NextIntlClientProvider } from "next-intl";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import en from "@/i18n/messages/en.json";
import { navigation } from "@/test/url-navigation";
import { disciplineServiceMock } from "@/test/discipline-metadata";
import { useWorkspaceStore } from "@/stores/workspace.store";
import type { CustomGame } from "@/services/custom-game.service";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

const mocks = vi.hoisted(() => ({ list: vi.fn(), stats: vi.fn(), create: vi.fn() }));

vi.mock("next/navigation", async () => (await import("@/test/url-navigation")).nextNavigationMock);
vi.mock("@/services/discipline.service", () => disciplineServiceMock);
vi.mock("@/hooks/usePermissions", () => ({ usePermissions: () => ({ canAccessPermission: () => true }) }));
vi.mock("@/services/custom-game.service", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    customGameService: { list: mocks.list, stats: mocks.stats, create: mocks.create }
  };
});

import BalancerPickupListPage from "./page";

function mix(id: number, discipline: string, name: string): CustomGame {
  return {
    id,
    workspace_id: 1,
    discipline,
    host_user_id: 9,
    co_hosts: [],
    host_display_name: "Host",
    name,
    status: "draft",
    settings: { points_per_win: 0, team_names: {}, workspace_discord_channel_id: null },
    created_at: "2026-01-02T00:00:00Z",
    lobby_count: 1,
    lobbies: [{ lobby_index: 0, selected_variant_index: 0, next_map_id: null, balanced_at: null }],
    self_signup: "closed",
    self_role_edit: false,
    roster_shape: null,
    matches_count: 0,
    last_match_at: null
  } as unknown as CustomGame;
}

const OW_MIX = mix(1, "overwatch", "Overwatch night");
const LOL_MIX = mix(2, "lol", "Rift night");

const mounts: { root: Root; container: HTMLDivElement }[] = [];

async function mountPage(url: string) {
  navigation.reset(url);
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  mounts.push({ root, container });
  await act(async () => {
    root.render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <NextIntlClientProvider locale="en" messages={en} timeZone="UTC">
          <BalancerPickupListPage />
        </NextIntlClientProvider>
      </QueryClientProvider>
    );
  });
  await settle();
  return container;
}

async function settle() {
  for (let index = 0; index < 4; index += 1) {
    await act(async () => {
      const { promise, resolve } = Promise.withResolvers<void>();
      setTimeout(resolve, 0);
      await promise;
    });
  }
}

beforeEach(() => {
  mocks.list.mockReset().mockImplementation(async (_workspaceId: number, discipline: string | null) =>
    [OW_MIX, LOL_MIX].filter((game) => discipline === null || game.discipline === discipline)
  );
  mocks.stats.mockReset().mockResolvedValue({ since: null, members: [] });
  mocks.create.mockReset().mockResolvedValue(LOL_MIX);
  useWorkspaceStore.setState({
    currentWorkspaceId: 1,
    workspaces: [{ id: 1, name: "OWT", disciplines_enabled: ["overwatch", "lol"] }] as never,
    statsScope: "workspace",
    hostLockedWorkspaceId: null,
    browsingDiscipline: null,
    isLoading: false
  });
});

afterEach(() => {
  for (const { root, container } of mounts.splice(0)) {
    act(() => root.unmount());
    container.remove();
  }
  document.body.innerHTML = "";
});

const rows = (container: ParentNode) => [...container.querySelectorAll("li a")].map((link) => link.textContent ?? "");

describe("mix directory browsing game", () => {
  it("lists every game under all games and names each row's game", async () => {
    const container = await mountPage("/balancer/mix?discipline=all");

    expect(mocks.list).toHaveBeenCalledTimes(1);
    expect(mocks.list.mock.calls[0][0]).toBe(1);
    expect(mocks.list.mock.calls[0][1]).toBeNull();
    expect(mocks.stats.mock.calls.map((call) => call[2])).toEqual([undefined]);
    const text = rows(container).join("|");
    expect(text).toContain("Overwatch night");
    expect(text).toContain("Rift night");
    expect(text).toContain("League of Legends");
  });

  it("narrows the list and the scoreboard to the chosen game", async () => {
    const container = await mountPage("/balancer/mix?discipline=lol");

    expect(mocks.list.mock.calls.map((call) => [call[0], call[1]])).toEqual([[1, "lol"]]);
    expect(mocks.stats.mock.calls.map((call) => call[2])).toEqual(["lol"]);
    expect(rows(container).join("|")).toContain("Rift night");
    expect(rows(container).join("|")).not.toContain("Overwatch night");
  });

  it("never shows the previous game's rows for the next one", async () => {
    const pending = Promise.withResolvers<CustomGame[]>();
    const container = await mountPage("/balancer/mix?discipline=overwatch");
    expect(rows(container).join("|")).toContain("Overwatch night");

    mocks.list.mockImplementationOnce(() => pending.promise);
    await act(async () => navigation.push("/balancer/mix?discipline=lol"));
    await settle();

    // The LoL read is still in flight: the OW rows must not stand in for it.
    expect(rows(container).join("|")).not.toContain("Overwatch night");
    expect(container.querySelector('[role="status"]')?.textContent).toContain("Loading");

    await act(async () => pending.resolve([LOL_MIX]));
    await settle();
    expect(rows(container).join("|")).toContain("Rift night");
  });

  it("makes no read for an invalid game and names it", async () => {
    const container = await mountPage("/balancer/mix?discipline=chess");

    expect(mocks.list).not.toHaveBeenCalled();
    expect(mocks.stats).not.toHaveBeenCalled();
    expect(container.textContent).toContain("chess");
    expect(rows(container)).toEqual([]);
  });

  it("creates a mix for the directory's game", async () => {
    const container = await mountPage("/balancer/mix?discipline=lol");

    await act(async () => {
      [...container.querySelectorAll("button")].find((button) => button.textContent?.includes("Create mix"))?.click();
    });
    await settle();
    const form = document.body.querySelector("form");
    expect(form).not.toBeNull();
    expect(document.body.querySelector("#pickup-discipline")?.textContent).toBe("League of Legends");
    await act(async () => {
      form?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    await settle();

    expect(mocks.create).toHaveBeenCalledWith(1, "lol", expect.any(String), null);
  });
});
