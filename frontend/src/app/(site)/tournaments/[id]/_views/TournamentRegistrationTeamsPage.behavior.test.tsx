// @vitest-environment happy-dom
//
// The public roster of registered teams. Three things are pinned here:
//
//  1. a team card carries its name, its lifecycle status, and its roster with
//     the captain and the substitutes marked — the roster is the whole page;
//  2. a team that is short reads as what it still needs (the server's own
//     shortfall string), and a full one reads as complete;
//  3. invites NEVER reach the DOM. The public endpoint omits them server-side
//     so the roster cannot leak who was asked and declined; this test holds the
//     client to the same rule by handing it a payload that carries them anyway.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NextIntlClientProvider } from "next-intl";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import en from "@/i18n/messages/en.json";
import type { RegistrationTeam } from "@/types/registration-team.types";
import type { Tournament } from "@/types/tournament.types";

import TournamentRegistrationTeamsPage from "./TournamentRegistrationTeamsPage";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const TOURNAMENT_ID = 88;

const listPublic = vi.fn();

vi.mock("@/services/registration-team.service", () => ({
  default: { listPublic: (...args: unknown[]) => listPublic(...args) }
}));

let tournament: Tournament;

vi.mock("../_hooks/useTournamentClientData", () => ({
  useTournamentQuery: () => ({ data: tournament, isError: false, refetch: () => {} })
}));

/**
 * Every field spelled out rather than cast: `tsconfig.json` excludes test
 * files, so a fixture that lies about its shape type-checks green.
 */
function makeTournament(): Tournament {
  return {
    id: TOURNAMENT_ID,
    created_at: new Date(0),
    updated_at: null,
    workspace_id: 3,
    name: "Anak Cup",
    start_date: new Date(0),
    end_date: new Date(0),
    description: null,
    challonge_id: null,
    challonge_slug: null,
    is_league: false,
    is_finished: false,
    is_hidden: false,
    team_formation: "registration",
    status: "registration",
    auto_transitions_enabled: true,
    allow_late_registration: false,
    phase_schedule: [],
    win_points: 1,
    draw_points: 0.5,
    loss_points: 0,
    stages: [],
    participants_count: 4,
    registrations_count: 4,
    teams_count: null,
    division_grid_version_id: null,
    division_grid_version: null,
    roster_slots_json: null,
    roster_shape: null,
    roster_locked_by_draft: null
  };
}

function makeTeam(overrides: Partial<RegistrationTeam> = {}): RegistrationTeam {
  return {
    id: 11,
    tournament_id: TOURNAMENT_ID,
    name: "Team Aqua",
    image_url: null,
    status: "forming",
    captain_registration_id: 401,
    exported_team_id: null,
    members: [
      {
        registration_id: 402,
        display_name: "Backline",
        battle_tag: "Backline#1",
        slot_code: "support",
        is_substitute: true,
        is_captain: false,
        status: "approved"
      },
      {
        registration_id: 401,
        display_name: "Anak",
        battle_tag: "Anak#2100",
        slot_code: "dps",
        is_substitute: false,
        is_captain: true,
        status: "approved"
      }
    ],
    invites: [],
    open_slots: { tank: 1 },
    shortfall: "1x tank",
    is_complete: false,
    substitutes_used: 1,
    max_substitutes: 2,
    ...overrides
  };
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.clearAllMocks();
  tournament = makeTournament();
  listPublic.mockResolvedValue({ items: [makeTeam()], total: 1 });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

/** Let queued promise callbacks and React Query's own scheduling drain. */
async function settle(ticks = 3) {
  for (let index = 0; index < ticks; index += 1) {
    await act(async () => {
      const { promise, resolve } = Promise.withResolvers<void>();
      setTimeout(resolve, 0);
      await promise;
    });
  }
}

async function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => {
    root.render(
      <QueryClientProvider client={client}>
        <NextIntlClientProvider locale="en" messages={en}>
          <TournamentRegistrationTeamsPage tournamentId={TOURNAMENT_ID} />
        </NextIntlClientProvider>
      </QueryClientProvider>
    );
  });
  await settle();
}

const COPY = en.registrationTeams;

describe("public registered-team roster", () => {
  it("renders a team with its status, roster and what it still needs", async () => {
    await mount();
    const text = container.textContent ?? "";

    expect(listPublic).toHaveBeenCalledWith(TOURNAMENT_ID);
    expect(text).toContain("Team Aqua");
    expect(text).toContain(COPY.status.forming);
    expect(text).toContain("Anak");
    expect(text).toContain("Backline");
    expect(text).toContain(COPY.member.captain);
    expect(text).toContain(COPY.member.substitute);
    expect(text).toContain(COPY.list.shortfall.replace("{slots}", "1× Tank"));
    expect(text).not.toContain(COPY.list.complete);

    // Starters read before substitutes, whatever order the payload arrived in.
    const rows = Array.from(container.querySelectorAll("li"));
    expect(rows.map((row) => row.textContent?.includes("Anak"))).toEqual([true, false]);
  });

  it("reads as complete once the roster is full", async () => {
    listPublic.mockResolvedValue({
      items: [makeTeam({ status: "complete", is_complete: true, open_slots: {}, shortfall: "" })],
      total: 1
    });
    await mount();

    expect(container.textContent).toContain(COPY.list.complete);
  });

  it("never renders invites, even when a payload carries them", async () => {
    listPublic.mockResolvedValue({
      items: [
        makeTeam({
          invites: [
            {
              id: 77,
              slot_code: "tank",
              is_substitute: false,
              state: "declined",
              target_auth_user_id: 909,
              is_link: false,
              expires_at: null,
              invited_at: null
            }
          ]
        })
      ],
      total: 1
    });
    await mount();
    const text = container.textContent ?? "";

    expect(text).not.toContain(COPY.inviteState.declined);
    expect(text).not.toContain("909");
  });

  it("shows the roster's own empty copy when nobody has registered a team", async () => {
    listPublic.mockResolvedValue({ items: [], total: 0 });
    await mount();

    expect(container.textContent).toContain(COPY.list.empty);
  });
});
