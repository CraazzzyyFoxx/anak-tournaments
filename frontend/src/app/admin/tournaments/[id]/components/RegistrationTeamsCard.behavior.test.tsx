// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NextIntlClientProvider } from "next-intl";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import en from "@/i18n/messages/en.json";
import { ApiError } from "@/lib/api-error";
import type { RegistrationTeam } from "@/types/registration-team.types";
import { RegistrationTeamsCard } from "./RegistrationTeamsCard";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const listAdmin = vi.fn();
const reject = vi.fn();
const exportRegistered = vi.fn();
const notifySuccess = vi.fn();
const notifyInfo = vi.fn();
const notifyError = vi.fn();

vi.mock("@/services/registration-team.service", () => ({
  default: {
    listAdmin: (...args: unknown[]) => listAdmin(...args),
    reject: (...args: unknown[]) => reject(...args),
    exportRegistered: (...args: unknown[]) => exportRegistered(...args)
  }
}));
vi.mock("@/hooks/usePermissions", () => ({
  usePermissions: () => ({ canAccessPermission: () => true, isLoaded: true, isSuperuser: true })
}));
vi.mock("@/lib/notify", () => ({
  notify: {
    success: (...args: unknown[]) => notifySuccess(...args),
    info: (...args: unknown[]) => notifyInfo(...args),
    error: (...args: unknown[]) => notifyError(...args)
  }
}));

const TOURNAMENT_ID = 80;
const WORKSPACE_ID = 3;

function team(overrides: Partial<RegistrationTeam> = {}): RegistrationTeam {
  return {
    id: 1,
    tournament_id: TOURNAMENT_ID,
    name: "Team Alpha",
    image_url: null,
    status: "forming",
    captain_registration_id: 11,
    exported_team_id: null,
    members: [
      {
        registration_id: 11,
        display_name: "Nyx",
        battle_tag: "Nyx#2100",
        slot_code: "tank",
        is_substitute: false,
        is_captain: true,
        status: "approved"
      }
    ],
    invites: [
      {
        id: 5,
        slot_code: "dps",
        is_substitute: false,
        state: "pending",
        target_auth_user_id: null,
        is_link: true,
        expires_at: "2026-09-01T12:00:00Z",
        invited_at: "2026-08-20T12:00:00Z"
      }
    ],
    open_slots: { dps: 1, support: 2 },
    shortfall: "1x dps, 2x support",
    is_complete: false,
    substitutes_used: 0,
    max_substitutes: 1,
    ...overrides
  };
}

const COMPLETE_TEAM = team({
  id: 2,
  name: "Team Beta",
  status: "complete",
  invites: [],
  open_slots: {},
  shortfall: "",
  is_complete: true
});

// Roots are tracked so afterEach can tear them down (see TournamentLogsTab's
// behavior suite: React 19 otherwise dereferences `window` after teardown).
const mounted: { root: Root; container: HTMLElement }[] = [];

async function settle() {
  for (let turn = 0; turn < 5; turn += 1) {
    await act(async () => {
      const { promise, resolve } = Promise.withResolvers<void>();
      setTimeout(resolve, 0);
      await promise;
    });
  }
}

async function mount() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const root = createRoot(container);
  mounted.push({ root, container });
  await act(async () => {
    root.render(
      <QueryClientProvider client={client}>
        <NextIntlClientProvider locale="en" messages={en} timeZone="UTC">
          <RegistrationTeamsCard tournamentId={TOURNAMENT_ID} workspaceId={WORKSPACE_ID} />
        </NextIntlClientProvider>
      </QueryClientProvider>
    );
  });
  await settle();
  return container;
}

async function click(node: Element | null | undefined) {
  expect(node).toBeTruthy();
  await act(async () => {
    node?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  await settle();
}

function buttonWithText(scope: ParentNode, text: string): HTMLButtonElement | undefined {
  return [...scope.querySelectorAll("button")].find((node) =>
    node.textContent?.includes(text)
  ) as HTMLButtonElement | undefined;
}

/** Radix portals the confirmation outside the render container. */
function confirmDialog(): HTMLElement | null {
  return document.body.querySelector("[role='alertdialog']");
}

beforeEach(() => {
  listAdmin.mockReset().mockResolvedValue({ items: [team(), COMPLETE_TEAM], total: 2 });
  reject.mockReset().mockResolvedValue(team({ status: "rejected" }));
  exportRegistered.mockReset().mockResolvedValue({
    removed_teams: 0,
    imported_teams: 1,
    created_players: 5,
    skipped: []
  });
  notifySuccess.mockReset();
  notifyInfo.mockReset();
  notifyError.mockReset();
});

afterEach(async () => {
  await act(async () => {
    for (const { root, container } of mounted.splice(0)) {
      root.unmount();
      container.remove();
    }
  });
});

describe("RegistrationTeamsCard", () => {
  it("puts the shortfall of every incomplete team on screen", async () => {
    const scope = await mount();

    // The reason the card exists: which roster is still short, and by what.
    // Rendered from `open_slots` through the shared role labels, NOT from the
    // server's English `shortfall` string.
    expect(scope.textContent).toContain("Still needed: 1× Damage, 2× Support");
    expect(scope.textContent).not.toContain("1x dps");
    expect(scope.textContent).toContain("Roster complete");
    expect(scope.textContent).toContain("2 teams");
    expect(scope.textContent).toContain("Nyx");
    expect(scope.textContent).toContain("Captain");
    expect(scope.textContent).toContain("0 of 1 substitutes");
    expect(listAdmin).toHaveBeenCalledWith(TOURNAMENT_ID, { includeTerminal: false });
  });

  it("shows the organizer the invites the public roster hides", async () => {
    const scope = await mount();

    expect(scope.textContent).toContain("Pending");
    expect(scope.textContent).toContain("Expires");
    // The complete team has none, and says so rather than rendering an empty gap.
    expect(scope.textContent).toContain("No open invites.");
  });

  it("refetches with terminal teams when the toggle flips", async () => {
    const scope = await mount();

    await click(scope.querySelector("[role='switch']"));

    expect(listAdmin).toHaveBeenCalledWith(TOURNAMENT_ID, { includeTerminal: true });
  });

  it("withdraws the members by default when a team is rejected", async () => {
    const scope = await mount();

    await click(buttonWithText(scope, "Reject team"));
    const dialog = confirmDialog();
    expect(dialog?.textContent).toContain("Reject Team Alpha?");
    expect(dialog?.querySelector("[role='checkbox']")?.getAttribute("data-state")).toBe("checked");

    await click(buttonWithText(dialog!, "Reject team"));

    expect(reject).toHaveBeenCalledWith(TOURNAMENT_ID, 1, { withdrawMembers: true });
    expect(notifySuccess).toHaveBeenCalledWith("Team rejected.");
  });

  it("honours an unchecked withdraw box", async () => {
    const scope = await mount();

    await click(buttonWithText(scope, "Reject team"));
    const dialog = confirmDialog();
    await click(dialog?.querySelector("[role='checkbox']"));
    await click(buttonWithText(dialog!, "Reject team"));

    expect(reject).toHaveBeenCalledWith(TOURNAMENT_ID, 1, { withdrawMembers: false });
  });

  it("keeps the skipped teams on screen after the export toast is gone", async () => {
    exportRegistered.mockResolvedValue({
      removed_teams: 0,
      imported_teams: 1,
      created_players: 5,
      skipped: [{ team_id: 9, name: "Team Gamma", code: "standings_exist" }]
    });

    const scope = await mount();
    await click(buttonWithText(scope, "Add teams to the tournament"));

    expect(exportRegistered).toHaveBeenCalledWith(TOURNAMENT_ID);
    expect(notifySuccess).toHaveBeenCalledWith("1 team added.", {
      description: "Skipped: Team Gamma"
    });
    // A toast expires; an organizer must still be able to see which team did not go.
    expect(scope.textContent).toContain("Skipped: Team Gamma");
  });

  it("says nothing was added when no roster was complete", async () => {
    exportRegistered.mockResolvedValue({
      removed_teams: 0,
      imported_teams: 0,
      created_players: 0,
      skipped: []
    });

    const scope = await mount();
    await click(buttonWithText(scope, "Add teams to the tournament"));

    expect(notifyInfo).toHaveBeenCalledWith("No complete teams to add.", {
      description: undefined
    });
    expect(notifySuccess).not.toHaveBeenCalled();
  });

  it("translates a rejection code instead of rendering the server's English", async () => {
    reject.mockRejectedValue(
      new ApiError(409, [
        { msg: "Team was already exported", code: "team_already_exported" }
      ])
    );

    const scope = await mount();
    await click(buttonWithText(scope, "Reject team"));
    await click(buttonWithText(confirmDialog()!, "Reject team"));

    // The server's English `msg` must never reach the organizer.
    expect(notifyError).toHaveBeenCalledWith(
      "This team has already been added to the tournament and can no longer be changed."
    );
  });
});
