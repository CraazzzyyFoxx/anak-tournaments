// @vitest-environment happy-dom
//
// The person hub is game-neutral, so the Ranks tab's two one-game blocks — the rank table and the rank history —
// keep their own game tabs (R23): they open on the page's `?discipline=`, else the first game — the site's saved scope
// and last game never reach the admin — and a pick is the page's `?discipline=`, which both blocks read.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";
import { useWorkspaceStore } from "@/stores/workspace.store";
import { navigation } from "@/test/url-navigation";

import PersonHubPage from "./page";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const listRanks = vi.fn();

vi.mock("next/navigation", async () => ({
  ...(await import("@/test/url-navigation")).nextNavigationMock,
  useParams: () => ({ id: "42" })
}));
vi.mock("@/services/discipline.service", async () => (await import("@/test/discipline-metadata")).disciplineServiceMock);
vi.mock("@/hooks/usePermissions", () => ({
  usePermissions: () => ({ canAccessPermission: () => true, hasPermission: () => true, isSuperuser: false, isLoaded: true })
}));
vi.mock("@/lib/datetime/client", () => ({
  useFormatter: () => ({ dateTime: (value: Date) => value.toISOString() })
}));
vi.mock("@/hooks/useCurrentWorkspace", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/hooks/useCurrentWorkspace")>()),
  useDivisionGrid: () => ({ tiers: [] })
}));
vi.mock("@/services/admin.service", () => ({
  default: {
    getUsers: async () => ({ results: [{ id: 42, name: "nnniik#2515", social_accounts: [] }], total: 1, page: 1, per_page: -1 }),
    getRankCollectionStatus: async () => []
  }
}));
vi.mock("@/services/workspace-player.service", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  workspacePlayerService: {
    listRanks: (...args: unknown[]) => listRanks(...args),
    listAuthors: async () => ({ authors: [] })
  }
}));
// The history chart is the game's own module with its own suite; which game it is drawn for is the subject.
vi.mock("@/disciplines/DisciplineWidget", () => ({
  DisciplineWidget: ({ discipline }: { discipline: string }) => <div data-rank-history={discipline} />
}));

let root: Root;
let container: HTMLDivElement;

const tablists = () => [...container.querySelectorAll('[role="tablist"]')];
// A tab reads as its monogram then its name ("OWOverwatch").
const selectedGames = () =>
  tablists().map((list) => list.querySelector('[role="tab"][aria-selected="true"]')?.textContent);
const both = (name: string) => [expect.stringContaining(name), expect.stringContaining(name)];

async function settle() {
  for (let turn = 0; turn < 8; turn += 1) {
    await act(async () => {
      const { promise, resolve } = Promise.withResolvers<void>();
      setTimeout(resolve, 0);
      await promise;
    });
  }
}

beforeEach(() => {
  // Node's own `localStorage` throws without `--localstorage-file` and happy-dom does not shadow it; the table keeps
  // its density and column preferences there.
  const stored = new Map<string, string>();
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => stored.get(key) ?? null,
      setItem: (key: string, value: string) => void stored.set(key, value),
      removeItem: (key: string) => void stored.delete(key)
    }
  });
  listRanks.mockReset().mockResolvedValue({ page: 1, per_page: 30, total: 0, results: [] });
  useWorkspaceStore.setState({
    workspaces: [{ id: 1, name: "OWT", disciplines_enabled: ["overwatch", "lol"] }] as never,
    currentWorkspaceId: 1,
    statsScope: "workspace",
    hostLockedWorkspaceId: null,
    entityWorkspaceId: null,
    entityDiscipline: null,
    gameScope: "lol",
    lastGame: "lol"
  });
  navigation.reset("/admin/people/42?tab=ranks");
  container = document.body.appendChild(document.createElement("div"));
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe("the person hub's Ranks tab", () => {
  it("opens both rank blocks on the first game whatever the site's saved game, and a League pick switches both", async () => {
    await act(async () => {
      root.render(
        <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
          <TooltipProvider>
            <PersonHubPage />
          </TooltipProvider>
        </QueryClientProvider>
      );
    });
    await settle();

    expect(selectedGames()).toEqual(both("Overwatch"));
    expect(container.querySelector("[data-rank-history=overwatch]")).not.toBeNull();

    const league = tablists()[0]?.querySelector<HTMLElement>('[role="tab"]:not([aria-selected="true"])');
    await act(async () => league?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 })));
    await settle();

    expect(navigation.current()).toBe("/admin/people/42?tab=ranks&discipline=lol");
    expect(selectedGames()).toEqual(both("League of Legends"));
    expect(listRanks.mock.calls.at(-1)?.[1]).toMatchObject({ discipline: "lol" });
    // League collects its own native ranks: its own history, never Overwatch's.
    expect(container.querySelector("[data-rank-history=lol]")).not.toBeNull();
  });
});
