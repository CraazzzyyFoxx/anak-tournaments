// @vitest-environment happy-dom
//
// One settings section, and the two claims every one of the eleven makes:
//
//   1. the section gate is the PAGE's, not the rail's. Hiding a link is not
//      access control — `/settings/general` typed into the address bar has to
//      be refused too;
//   2. a section PATCHes its own changed fields and nothing else. The
//      pre-redesign form sent every field it held on every save, so renaming a
//      tournament recorded a full rewrite of its rules, schedule and scoring in
//      the audit trail (`model_dump(exclude_unset=True)` records exactly the
//      keys a PATCH sends).
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Tournament } from "@/types/tournament.types";
import GeneralSettingsPage from "./page";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const getTournament = vi.fn();
const updateTournament = vi.fn();
const setTournamentSchedule = vi.fn();

vi.mock("@/services/admin.service", () => ({
  default: {
    getTournament: (...args: unknown[]) => getTournament(...args),
    updateTournament: (...args: unknown[]) => updateTournament(...args),
    setTournamentSchedule: (...args: unknown[]) => setTournamentSchedule(...args)
  }
}));

vi.mock("next/navigation", () => ({
  useParams: () => ({ id: "64" }),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() })
}));

let canUpdateTournament = true;
vi.mock("@/hooks/usePermissions", () => ({
  usePermissions: () => ({
    isLoaded: true,
    canAccessPermission: (permission: string) =>
      permission === "tournament.update" ? canUpdateTournament : true
  })
}));

// The audit drawer is the admin's, not this section's: it has its own tests and
// its own permission, and mounting it here would only add a count query.
vi.mock("@/components/admin/AuditTrailSheet", () => ({ AuditTrailButton: () => null }));

vi.mock("@/lib/notify", () => ({
  notify: { success: vi.fn(), error: vi.fn(), info: vi.fn(), apiError: vi.fn() }
}));

vi.mock("@/stores/workspace.store", () => ({
  useWorkspaceStore: (selector: (state: { workspaces: unknown[] }) => unknown) =>
    selector({ workspaces: [] })
}));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key
}));

const TOURNAMENT: Tournament = {
  id: 64,
  created_at: new Date("2026-01-01T00:00:00Z"),
  updated_at: null,
  workspace_id: 1,
  name: "OWT 64",
  slug: "owt-64",
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

let container: HTMLDivElement;
let root: Root;

async function settle(times = 4) {
  for (let turn = 0; turn < times; turn += 1) {
    await act(async () => {
      const { promise, resolve } = Promise.withResolvers<void>();
      setTimeout(resolve, 0);
      await promise;
    });
  }
}

async function render() {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })}
      >
        <GeneralSettingsPage />
      </QueryClientProvider>
    );
  });
  await settle();
}

/** Type into a controlled input the way React's synthetic layer sees it. */
async function type(input: HTMLInputElement, value: string) {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(
      globalThis.HTMLInputElement.prototype,
      "value"
    )?.set;
    setter?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await settle(2);
}

function button(label: string) {
  return [...document.querySelectorAll("button")].find(
    (node) => node.textContent?.trim() === label
  );
}

beforeEach(() => {
  canUpdateTournament = true;
  getTournament.mockReset().mockResolvedValue(TOURNAMENT);
  updateTournament.mockReset().mockResolvedValue(TOURNAMENT);
  setTournamentSchedule.mockReset().mockResolvedValue(undefined);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  document.body.innerHTML = "";
});

describe("Settings › General", () => {
  it("refuses the section to a caller without tournament.update", async () => {
    canUpdateTournament = false;
    await render();

    expect(container.textContent).toContain("Not permitted");
    expect(container.querySelector("#settings-name")).toBeNull();
  });

  it("keeps the save bar away until something actually changed", async () => {
    await render();

    expect(container.querySelector<HTMLInputElement>("#settings-name")?.value).toBe("OWT 64");
    expect(container.querySelector('[aria-label="Unsaved changes"]')).toBeNull();
  });

  it("PATCHes the edited field alone, and never the schedule", async () => {
    await render();

    await type(container.querySelector<HTMLInputElement>("#settings-name")!, "OWT 65");
    expect(container.querySelector('[aria-label="Unsaved changes"]')?.textContent).toContain(
      "1 changed field"
    );

    await act(async () => {
      button("Save changes")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await settle();

    expect(updateTournament).toHaveBeenCalledTimes(1);
    // The whole point: `slug`, `description`, the scoring, the roster shape and
    // every other field of the tournament stay out of the request.
    expect(updateTournament).toHaveBeenCalledWith(64, { name: "OWT 65" });
    expect(setTournamentSchedule).not.toHaveBeenCalled();
  });

  it("discards back to the stored values", async () => {
    await render();

    await type(container.querySelector<HTMLInputElement>("#settings-name")!, "typo");
    await act(async () => {
      button("Discard")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await settle();

    expect(container.querySelector<HTMLInputElement>("#settings-name")?.value).toBe("OWT 64");
    expect(updateTournament).not.toHaveBeenCalled();
  });
});
