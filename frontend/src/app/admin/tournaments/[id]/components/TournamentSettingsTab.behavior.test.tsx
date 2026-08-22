// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AuditTrailProvider } from "@/components/admin/AuditTrailSheet";
import type { Tournament } from "@/types/tournament.types";
import { TournamentSettingsTab } from "./TournamentSettingsTab";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const updateTournament = vi.fn();
const setTournamentSchedule = vi.fn();
const setDiscordChannel = vi.fn();
const challongeSyncLog = vi.fn();

vi.mock("@/services/admin.service", () => ({
  default: {
    updateTournament: (...args: unknown[]) => updateTournament(...args),
    setTournamentSchedule: (...args: unknown[]) => setTournamentSchedule(...args),
    setDiscordChannel: (...args: unknown[]) => setDiscordChannel(...args),
    challongeSyncLog: (...args: unknown[]) => challongeSyncLog(...args),
    deleteTournament: vi.fn(),
    deleteDiscordChannel: vi.fn(),
    challongeImport: vi.fn(),
    challongeExport: vi.fn()
  }
}));
vi.mock("@/lib/notify", () => ({
  notify: { success: vi.fn(), error: vi.fn(), info: vi.fn(), apiError: vi.fn() }
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() })
}));
vi.mock("@/stores/workspace.store", () => ({
  useWorkspaceStore: (selector: (state: { workspaces: unknown[] }) => unknown) =>
    selector({ workspaces: [] })
}));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
  useLocale: () => "en"
}));

const TOURNAMENT: Tournament = {
  id: 64,
  created_at: new Date("2026-01-01T00:00:00Z"),
  updated_at: null,
  workspace_id: 1,
  name: "OWT 64",
  start_date: new Date("2026-04-18T00:00:00Z"),
  end_date: new Date("2026-04-19T00:00:00Z"),
  description: null,
  challonge_id: null,
  challonge_slug: "owt-64",
  is_league: false,
  is_finished: false,
  is_hidden: false,
  team_formation: "balancer",
  status: "live",
  auto_transitions_enabled: true,
  allow_late_registration: false,
  phase_schedule: [],
  win_points: 3,
  draw_points: 1,
  loss_points: 0,
  stages: [],
  participants_count: 20,
  registrations_count: 20,
  teams_count: 20,
  division_grid_version_id: null,
  division_grid_version: null
};

async function settle() {
  for (let turn = 0; turn < 4; turn += 1) {
    await act(async () => {
      const { promise, resolve } = Promise.withResolvers<void>();
      setTimeout(resolve, 0);
      await promise;
    });
  }
}

const mountedRoots: { root: ReturnType<typeof createRoot>; container: HTMLDivElement }[] = [];

async function mount() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const root = createRoot(container);
  mountedRoots.push({ root, container });
  await act(async () => {
    root.render(
      <QueryClientProvider client={client}>
        {/* The settings header opens the shared audit drawer, which the admin
            layout mounts in the real app. */}
        <AuditTrailProvider>
          <TournamentSettingsTab
            tournament={TOURNAMENT}
            tournamentId={64}
            divisionGridVersions={[]}
            divisionGridLoading={false}
            canDeleteTournament
            canUpdateTournament
            hasChallongeSource
            discordChannel={null}
            discordChannelLoading={false}
          />
        </AuditTrailProvider>
      </QueryClientProvider>
    );
  });
  await settle();
  return container;
}

function click(node: Element | null | undefined) {
  if (!node) throw new Error("nothing to click");
  node.dispatchEvent(new MouseEvent("click", { bubbles: true }));
}

/** Type into a controlled input the way React's synthetic layer sees it. */
function type(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(
    globalThis.HTMLInputElement.prototype,
    "value"
  )?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

/** Opens the Discord dialog and returns the form portalled out of the tab. */
async function openChannelDialog(scope: Element) {
  const addChannel = [...scope.querySelectorAll("button")].find((button) =>
    button.textContent?.includes("Add channel")
  );
  await act(async () => {
    click(addChannel);
  });
  await settle();

  // The dialog is portalled out of the form, but React events bubble through
  // the React tree, so its submit would otherwise reach the settings form.
  const dialogForm = [...document.querySelectorAll("form")].find((form) => !scope.contains(form));
  if (!dialogForm) throw new Error("channel dialog not rendered");
  return dialogForm;
}

function integrationsCard(scope: Element) {
  const card = scope.querySelector("#settings-challonge")?.closest("[data-ui='card']");
  if (!card) throw new Error("integrations card not rendered");
  return card;
}

beforeEach(() => {
  updateTournament.mockReset().mockResolvedValue(TOURNAMENT);
  setTournamentSchedule.mockReset().mockResolvedValue(undefined);
  setDiscordChannel.mockReset().mockResolvedValue(undefined);
  challongeSyncLog.mockReset().mockResolvedValue([]);
});

// Mounted trees are torn down between tests: the Discord dialog portals into
// `document.body`, and a leftover tree there would be indistinguishable from it.
afterEach(() => {
  for (const mounted of mountedRoots.splice(0)) {
    act(() => mounted.root.unmount());
    mounted.container.remove();
  }
});

describe("TournamentSettingsTab integrations card", () => {
  it("keeps the Challonge link field with its sync controls", async () => {
    const scope = await mount();
    const card = integrationsCard(scope);

    expect(scope.querySelector<HTMLInputElement>("#settings-challonge")?.value).toBe("owt-64");
    // The link field, the sync triggers and the Discord block are one card.
    expect(card.textContent).toContain("Integrations");
    expect(card.textContent).toContain("Import");
    expect(card.textContent).toContain("Export");
    expect(card.textContent).toContain("Discord match logs");
    // …and that card is not simply the whole settings form.
    expect(card.textContent).not.toContain("Schedule & timeline");
  });

  it("never lets an integration button submit the settings form", async () => {
    const card = integrationsCard(await mount());
    const buttons = [...card.querySelectorAll("button")];

    expect(buttons.length).toBeGreaterThan(0);
    expect(buttons.filter((button) => button.type !== "button")).toEqual([]);
  });

  it("saves the Discord channel without saving the tournament with it", async () => {
    const scope = await mount();
    const dialogForm = await openChannelDialog(scope);

    // No guild is reachable in tests, so the picker offers its manual fallback.
    type(dialogForm.querySelector<HTMLInputElement>("#discord-channel-id")!, "987654321098765432");

    await act(async () => {
      dialogForm.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    await settle();

    expect(setDiscordChannel).toHaveBeenCalledTimes(1);
    expect(updateTournament).not.toHaveBeenCalled();
    expect(setTournamentSchedule).not.toHaveBeenCalled();
  });

  it("refuses to save a channel that was never chosen", async () => {
    const scope = await mount();
    const dialogForm = await openChannelDialog(scope);

    await act(async () => {
      dialogForm.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    await settle();

    expect(setDiscordChannel).not.toHaveBeenCalled();
    expect(dialogForm.querySelector("[role=alert]")?.textContent).toContain("Pick the channel");
  });
});
