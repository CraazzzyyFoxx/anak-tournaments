// @vitest-environment happy-dom
//
// The players table's layout and tournament scope, after the scope moved out of
// the toolbar select and into a "Tournament" column header. What is pinned here:
//  1. the funnel lives in the column header, not in a toolbar combobox, and
//     picking a tournament refetches the rosters for it;
//  2. the URL keeps the `tournament` spelling the sibling admin pages use, so a
//     pinned link still opens pinned;
//  3. the column order is Name, Team, Tournament, Role, Div · Rank, Sub-role,
//     Flags — division and rank ride in ONE cell, since division is derived
//     from rank and two columns for one fact just cost horizontal room;
//  4. "Name" is pinned, so scrolling sideways keeps the row identifiable;
//  5. "Create player" stays blocked until a tournament is picked — the gate
//     reads the same filter the table owns, which is why the filter is
//     controlled.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import PlayersPage from "./page";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { Team } from "@/types/team.types";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const getTeams = vi.fn();
const getTournaments = vi.fn();

vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("next/navigation", () => ({
  usePathname: () => "/admin/players",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() })
}));
vi.mock("@/hooks/usePermissions", () => ({
  usePermissions: () => ({ canAccessPermission: () => true })
}));
vi.mock("@/stores/workspace.store", () => ({
  useWorkspaceStore: (
    selector: (state: { currentWorkspaceId: number; getCurrentWorkspace: () => null }) => unknown
  ) => selector({ currentWorkspaceId: 1, getCurrentWorkspace: () => null })
}));
vi.mock("@/services/team.service", () => ({
  default: { getAll: (...args: unknown[]) => getTeams(...args) }
}));
vi.mock("@/services/tournament.service", () => ({
  default: { getAll: (...args: unknown[]) => getTournaments(...args) }
}));
vi.mock("@/services/admin.service", () => ({
  default: {
    getPlayerSubRoles: vi.fn().mockResolvedValue([]),
    createPlayer: vi.fn(),
    updatePlayer: vi.fn(),
    deletePlayer: vi.fn()
  }
}));
vi.mock("@/lib/notify", () => ({
  notify: { success: vi.fn(), error: vi.fn(), apiError: vi.fn() }
}));

const TOURNAMENTS = [
  { id: 7, name: "MoonRise Mix Vol.4" },
  { id: 8, name: "MoonRise Draft Vol.2" }
];

const TEAMS = [
  {
    id: 3,
    name: "nnniik",
    tournament_id: 7,
    tournament: { id: 7, name: "MoonRise Mix Vol.4", division_grid_version: null },
    players: [
      {
        id: 11,
        name: "nnniik#2515",
        role: "support",
        sub_role: null,
        rank: 1800,
        division: 9,
        tournament_id: 7,
        team_id: 3,
        is_newcomer: true,
        is_substitution: false
      }
    ]
  }
] as unknown as Team[];

let container: HTMLElement;
let root: Root;

function tick() {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, 0);
  return promise;
}

async function render(search = "") {
  window.history.replaceState(null, "", `/admin/players${search}`);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  await act(async () => {
    root.render(
      <QueryClientProvider client={client}>
        <TooltipProvider>
          <PlayersPage />
        </TooltipProvider>
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

function headerCells() {
  return [...container.querySelectorAll("thead th")];
}

function createButton() {
  return [...container.querySelectorAll("button")].find((node) =>
    node.textContent?.includes("Create player")
  );
}

function lastTournamentId(): unknown {
  return (getTeams.mock.calls.at(-1)?.[0] as { tournamentId?: unknown } | undefined)?.tournamentId;
}

beforeEach(() => {
  getTeams.mockReset().mockResolvedValue({ results: TEAMS, total: 1, page: 1, per_page: 15 });
  getTournaments
    .mockReset()
    .mockResolvedValue({ results: TOURNAMENTS, total: 2, page: 1, per_page: 50 });
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  container.remove();
});

describe("PlayersPage table layout", () => {
  it("puts the scope in the column header, not the toolbar", async () => {
    await render();

    expect(funnel()).not.toBeNull();
    expect(
      [...container.querySelectorAll("[role='combobox']")].some((node) =>
        node.textContent?.includes("All tournaments")
      )
    ).toBe(false);
  });

  it("orders the columns name-first and pins the name", async () => {
    await render();

    expect(headerCells().map((cell) => cell.textContent?.trim())).toEqual([
      "Name",
      "Team",
      "Tournament",
      "Role",
      "Div · Rank",
      "Sub-role",
      "Flags",
      ""
    ]);
    expect(headerCells()[0].className).toContain("admin-sticky-col");
    expect(
      container.querySelector("tbody tr")?.firstElementChild?.className
    ).toContain("admin-sticky-col");
  });

  it("shows the division icon and the rank in one cell", async () => {
    await render();

    const divisionCell = container.querySelectorAll("tbody tr td")[4];
    expect(divisionCell.querySelector("img")).not.toBeNull();
    expect(divisionCell.textContent).toContain("1800");
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
