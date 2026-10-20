// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it, vi } from "vitest";

import en from "@/i18n/messages/en.json";
import { EncountersBrowser } from "@/components/admin/EncountersBrowser";
import encounterService from "@/services/encounter.service";
import { LOL_GAME, OW_GAME } from "@/test/game-scope";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const getStages = vi.fn((tournamentId: number) =>
  Promise.resolve(
    tournamentId === 7
      ? [{ id: 70, name: "Playoffs", items: [{ id: 700, name: "Upper bracket" }] }]
      : []
  )
);

vi.mock("@/services/admin.service", () => ({
  default: {
    getStages: (tournamentId: number) => getStages(tournamentId),
    getTournament: vi.fn().mockResolvedValue({ id: 7, name: "Cup" })
  }
}));

vi.mock("@/services/tournament.service", () => ({
  default: {
    getAll: vi.fn().mockResolvedValue({
      results: [
        { id: 7, name: "Cup", discipline: "overwatch" },
        { id: 8, name: "Rift Cup", discipline: "lol" }
      ],
      total: 2,
      page: 1,
      per_page: -1
    })
  }
}));

vi.mock("@/services/team.service", () => ({
  default: { getAll: vi.fn().mockResolvedValue({ results: [], total: 0, page: 1, per_page: -1 }) }
}));

const encounter = {
  id: 1,
  name: "Averet vs SanekTheRio",
  format: "duel",
  home_team_id: 11,
  away_team_id: 12,
  score: { home: 0, away: 0 },
  round: 1,
  best_of: 3,
  tournament_id: 7,
  discipline: "overwatch",
  stage_id: 70,
  stage_item_id: 700,
  status: "OPEN",
  closeness: null,
  has_logs: false,
  result_status: "none",
  scheduled_at: null,
  tournament: { id: 7, name: "Cup" },
  stage: { id: 70, name: "Playoffs" },
  stage_item: { id: 700, name: "Upper bracket" },
  home_team: null,
  away_team: null,
  matches: [],
  games: []
};

vi.mock("@/services/encounter.service", () => ({
  default: {
    getAll: vi.fn(() => Promise.resolve({ results: [encounter], total: 1, page: 1, per_page: 15 }))
  }
}));

vi.mock("@/hooks/usePermissions", () => ({
  usePermissions: () => ({ canAccessPermission: () => true })
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/admin/matches",
  useRouter: () => ({
    replace: (url: string) => window.history.replaceState(null, "", url),
    push: vi.fn()
  }),
  useSearchParams: () => new URLSearchParams(window.location.search)
}));

vi.mock("@/lib/tournament/workspace-query-keys", () => ({
  invalidateTournamentWorkspace: vi.fn()
}));

vi.mock("@/hooks/useGameDescriptors", async () => {
  const { GAME_DESCRIPTORS } = await import("@/test/game-scope");
  return { useGameDescriptors: () => GAME_DESCRIPTORS };
});

async function tick() {
  await act(async () => {
    const { promise, resolve } = Promise.withResolvers<void>();
    setTimeout(resolve, 0);
    await promise;
  });
}

async function waitFor<T>(read: () => T | null | undefined | false, what: string): Promise<T> {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const value = read();
    if (value) return value as T;
    await tick();
  }
  throw new Error(`timed out waiting for ${what}`);
}

async function click(element: Element) {
  await act(async () => {
    element.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  await tick();
}

// An open dialog or popover left mounted closes on the next test's outside pointerdown, after its portal is gone.
const roots: Root[] = [];
afterEach(async () => {
  await act(async () => roots.splice(0).forEach((root) => root.unmount()));
  document.body.innerHTML = "";
});

describe("EncountersBrowser edit dialog", () => {
  it("offers the edited row's stages when no tournament chip is set", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const root = createRoot(container);
    roots.push(root);
    await act(async () => {
      root.render(
        <NextIntlClientProvider locale="en" messages={en}>
          <QueryClientProvider client={client}>
            <EncountersBrowser tournamentId={null} workspaceId={1} />
          </QueryClientProvider>
        </NextIntlClientProvider>
      );
    });

    const kebab = await waitFor(
      () => container.querySelector(`[aria-label*="${encounter.name}"]`),
      "row actions"
    );
    await click(kebab);
    const edit = await waitFor(
      () =>
        Array.from(document.querySelectorAll('[role="menuitem"]')).find(
          (item) => item.textContent?.trim() === en.adminMatches.encounters.edit
        ),
      "edit action"
    );
    await click(edit);

    const dialog = await waitFor(() => document.querySelector('[role="dialog"]'), "edit dialog");
    await waitFor(() => dialog.textContent?.includes("Playoffs"), "stage label");
    expect(dialog.textContent).toContain("Upper bracket");
    expect(getStages).toHaveBeenCalledWith(7);
  });
});

describe("EncountersBrowser under the game filter", () => {
  async function mountWith(discipline: string | null, search = "") {
    window.history.replaceState(null, "", `/admin/matches${search}`);
    const container = document.createElement("div");
    document.body.appendChild(container);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const root = createRoot(container);
    roots.push(root);
    await act(async () => {
      root.render(
        <NextIntlClientProvider locale="en" messages={en}>
          <QueryClientProvider client={client}>
            <EncountersBrowser
              tournamentId={null}
              workspaceId={1}
              discipline={discipline}
              games={[OW_GAME, LOL_GAME]}
            />
          </QueryClientProvider>
        </NextIntlClientProvider>
      );
    });
    // Only data rows carry `tabindex`; the loading skeleton's rows do not.
    await waitFor(() => container.querySelector("tbody tr[tabindex]"), "the encounter row");
    return container;
  }
  const lastFilters = () =>
    vi.mocked(encounterService.getAll).mock.calls.at(-1)?.[7] as { discipline?: string | null } | undefined;
  const headers = (container: HTMLElement) =>
    Array.from(container.querySelectorAll("th")).map((cell) => cell.textContent?.trim());
  /** Picker rows: an option's label sits beside its game mark, a filter row is its label alone. */
  const commandItems = () =>
    Array.from(document.querySelectorAll('[cmdk-item=""]')).map((item) => ({
      item,
      label: (item.querySelector(".truncate") ?? item).textContent?.trim()
    }));
  const commandItem = (label: string) => commandItems().find((entry) => entry.label === label)?.item;
  async function openFilter(container: HTMLElement, filter: string) {
    await click(container.querySelector('button[aria-label="Add filter"]')!);
    await click(await waitFor(() => commandItem(filter), `the ${filter} filter`));
  }
  const search = () => new URLSearchParams(window.location.search);

  it("lists every game's encounters with a Game column when no game is chosen", async () => {
    const container = await mountWith(null);

    expect(lastFilters()?.discipline).toBeNull();
    expect(headers(container)).toContain("Game");
    expect(container.querySelector("tbody")?.textContent).toContain("Overwatch");
  });

  it("asks the server for one game's encounters under a game, without the column", async () => {
    const container = await mountWith("lol");

    expect(lastFilters()?.discipline).toBe("lol");
    expect(headers(container)).not.toContain("Game");
  });

  it("applies the tournament, stage and group chips under all games", async () => {
    await mountWith(null, "?tournament=7&stage=70&group=700");

    const call = vi.mocked(encounterService.getAll).mock.calls.at(-1)!;
    expect(call[2]).toBe(7);
    expect(call[7]).toMatchObject({ stage_id: 70, stage_item_id: 700, discipline: null });
    expect(document.querySelector('button[aria-label^="Remove filter Tournament"]')).not.toBeNull();
  });

  it("leads with the Game chip and offers every game's tournaments without a game", async () => {
    const container = await mountWith(null);

    await click(container.querySelector('button[aria-label="Add filter"]')!);
    await waitFor(() => commandItem("Tournament"), "the filter list");
    expect(commandItems()[0]?.label).toBe("Game");
    await click(commandItem("Tournament")!);
    await waitFor(() => commandItem("Rift Cup"), "the tournament options");
    expect(commandItems().map((entry) => entry.label)).toEqual(["Cup", "Rift Cup"]);
  });

  it("a game pick drops a tournament of another game with its stage and group", async () => {
    const container = await mountWith(null, "?tournament=7&stage=70&group=700&status=OPEN");

    await openFilter(container, "Game");
    await click(await waitFor(() => commandItem("League of Legends"), "the League option"));

    expect(search().get("discipline")).toBe("lol");
    for (const param of ["tournament", "stage", "group"]) expect(search().has(param), param).toBe(false);
    expect(search().get("status")).toBe("OPEN");
  });

  it("a game pick keeps a tournament of that game", async () => {
    const container = await mountWith(null, "?tournament=7&stage=70");

    await openFilter(container, "Game");
    await click(await waitFor(() => commandItem("Overwatch"), "the Overwatch option"));

    expect(search().get("discipline")).toBe("overwatch");
    expect(search().get("tournament")).toBe("7");
    expect(search().get("stage")).toBe("70");
  });
});
