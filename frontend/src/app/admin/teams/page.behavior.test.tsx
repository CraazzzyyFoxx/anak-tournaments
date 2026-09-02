// @vitest-environment happy-dom
//
// The teams table's tournament scope, after it moved out of the toolbar select
// and into the "Tournament" column header. What is pinned here:
//  1. the funnel's options are the workspace's tournaments, and picking one
//     refetches the roster list for it;
//  2. the URL keeps the `tournament` spelling the sibling admin pages use, so a
//     pinned link still opens pinned;
//  3. "Create team" stays blocked until a tournament is picked — the gate reads
//     the same filter the table owns, which is why the filter is controlled.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import TeamsPage from "./page";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const getTeams = vi.fn();
const getTournaments = vi.fn();
const push = vi.fn();

vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("next/navigation", () => ({ usePathname: () => "/admin/teams", useRouter: () => ({ push }) }));
vi.mock("@/hooks/usePermissions", () => ({
  usePermissions: () => ({ canAccessPermission: () => true })
}));
vi.mock("@/stores/workspace.store", () => ({
  useWorkspaceStore: (selector: (state: { currentWorkspaceId: number }) => unknown) =>
    selector({ currentWorkspaceId: 1 })
}));
vi.mock("@/services/team.service", () => ({
  default: { getAll: (...args: unknown[]) => getTeams(...args) }
}));
vi.mock("@/services/tournament.service", () => ({
  default: { getAll: (...args: unknown[]) => getTournaments(...args) }
}));
vi.mock("@/services/admin.service", () => ({ default: { deleteTeam: vi.fn() } }));
vi.mock("@/lib/notify", () => ({
  notify: { success: vi.fn(), error: vi.fn(), apiError: vi.fn() }
}));

const TOURNAMENTS = [
  { id: 7, name: "MoonRise Mix Vol.4" },
  { id: 8, name: "MoonRise Draft Vol.2" }
];

let container: HTMLElement;
let root: Root;

function tick() {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, 0);
  return promise;
}

async function render(search = "") {
  window.history.replaceState(null, "", `/admin/teams${search}`);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  await act(async () => {
    root.render(
      <QueryClientProvider client={client}>
        <TeamsPage />
      </QueryClientProvider>
    );
  });
  for (let turn = 0; turn < 5; turn += 1) {
    await act(async () => {
      await tick();
    });
  }
}

async function click(element: Element | null | undefined) {
  await act(async () => {
    element?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await tick();
  });
}

function funnel() {
  return container.querySelector<HTMLButtonElement>('button[aria-label^="Filter by tournament"]');
}

function createButton() {
  return [...container.querySelectorAll("button")].find((node) =>
    node.textContent?.includes("Create team")
  );
}

function lastTournamentId(): unknown {
  return (getTeams.mock.calls.at(-1)?.[0] as { tournamentId?: unknown } | undefined)?.tournamentId;
}

beforeEach(() => {
  push.mockReset();
  getTeams.mockReset().mockResolvedValue({ results: [], total: 0, page: 1, per_page: 15 });
  getTournaments.mockReset().mockResolvedValue({ results: TOURNAMENTS, total: 2, page: 1, per_page: 50 });
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  container.remove();
});

describe("TeamsPage tournament filter", () => {
  it("puts the scope in the column header, not the toolbar", async () => {
    await render();

    expect(funnel()).not.toBeNull();
    expect(
      [...container.querySelectorAll("[role='combobox']")].some((node) =>
        node.textContent?.includes("All tournaments")
      )
    ).toBe(false);
  });

  it("refetches the rosters of the tournament picked from the header", async () => {
    await render();
    expect(lastTournamentId()).toBeNull();

    await click(funnel());
    await click(
      [...document.querySelectorAll('[cmdk-item=""]')].find(
        (item) => item.textContent?.trim() === "MoonRise Draft Vol.2"
      )
    );

    expect(lastTournamentId()).toBe(8);
    expect(window.location.search).toContain("tournament=8");
  });

  it("opens pinned from a link that carries the tournament", async () => {
    await render("?tournament=7");
    expect(lastTournamentId()).toBe(7);
  });

  it("keeps the create gate on the same value the table filters by", async () => {
    await render();
    expect(createButton()?.disabled).toBe(true);

    await click(funnel());
    await click(
      [...document.querySelectorAll('[cmdk-item=""]')].find(
        (item) => item.textContent?.trim() === "MoonRise Mix Vol.4"
      )
    );

    expect(createButton()?.disabled).toBe(false);
  });
});
