// @vitest-environment happy-dom
//
// The bracket needed the veto room's read-only content without its own page:
// a spectator clicking through the grid wants to see what got banned/picked,
// not to navigate away and lose their place. These tests cover the contract
// that is NEW here — lazy fetch behind a trigger, the closed-door copy, and a
// read-only render with no select affordance — not the grid/timeline's own
// grouping logic, which `vetoRoom.behavior.test.tsx` already covers exhaustively
// against the same unmodified components.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NextIntlClientProvider } from "next-intl";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import en from "@/i18n/messages/en.json";
import type { EncounterMapPoolEntry, EncounterMapPoolState, EncounterVetoSession } from "@/types/tournament.types";

import { EncounterMapPoolModal } from "./EncounterMapPoolModal";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const getMapPoolState = vi.fn();
const getAllMaps = vi.fn();

vi.mock("@/services/captain.service", () => ({
  default: { getMapPoolState: (...args: unknown[]) => getMapPoolState(...args) }
}));
vi.mock("@/services/map.service", () => ({
  default: { getAll: (...args: unknown[]) => getAllMaps(...args) }
}));
vi.mock("@/hooks/useRealtimeTopic", () => ({ useRealtimeTopic: () => undefined }));
vi.mock("next/image", () => ({
  // eslint-disable-next-line @next/next/no-img-element -- this IS the next/image stand-in
  default: ({ alt }: { alt: string }) => <img alt={alt} />
}));

const ROOM = en.encounters.veto.room;
const MAPS = [
  { id: 21, name: "Hanamura", image_path: "/hanamura.png", gamemode: null },
  { id: 22, name: "Kings Row", image_path: "/kings-row.png", gamemode: null }
];

function entry(overrides: Partial<EncounterMapPoolEntry>): EncounterMapPoolEntry {
  return {
    id: 1,
    map_id: 21,
    slot: null,
    order: 0,
    action_index: null,
    picked_by: null,
    team_id: null,
    status: "available",
    ...overrides
  };
}

function session(overrides: Partial<EncounterVetoSession> = {}): EncounterVetoSession {
  return {
    id: 1,
    status: "active",
    first_side: "home",
    seed_source: "bracket_slot",
    home_seed: 1,
    away_seed: 4,
    turn_timer_seconds: null,
    started_at: "2026-08-01T10:00:00Z",
    current_step_started_at: null,
    slot_reserves: null,
    ...overrides
  };
}

function state(overrides: Partial<EncounterMapPoolState>): EncounterMapPoolState {
  return {
    session: session(),
    sequence: [],
    pool: [],
    viewer_side: "home",
    viewer_can_act: false,
    allowed_actions: [],
    current_step_index: 0,
    current_step: null,
    expected_action: null,
    turn_side: null,
    current_slot: null,
    is_complete: false,
    ...overrides
  };
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.clearAllMocks();
  getAllMaps.mockResolvedValue({ results: MAPS });
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

async function mount(props: { roomHref?: string } = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => {
    root.render(
      <QueryClientProvider client={client}>
        <NextIntlClientProvider locale="en" messages={en}>
          <EncounterMapPoolModal
            encounterId={4242}
            homeTeamName="Bright Wolves"
            awayTeamName="Quiet Foxes"
            {...props}
          />
        </NextIntlClientProvider>
      </QueryClientProvider>
    );
  });
  await settle();
}

function trigger(label: string = en.bracket.viewMapPool): HTMLButtonElement {
  const button = container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
  if (!button) throw new Error(`trigger not rendered for label ${label}`);
  return button;
}

async function open(label?: string) {
  await act(async () => {
    trigger(label).dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  await settle();
}

describe("EncounterMapPoolModal", () => {
  it("fetches nothing until the trigger is clicked", async () => {
    getMapPoolState.mockResolvedValue(state({ session: null, reason: "not_configured" }));
    await mount();

    expect(getMapPoolState).not.toHaveBeenCalled();

    await open();
    expect(getMapPoolState).toHaveBeenCalledWith(4242);
  });

  it("shows the closed-door copy when the room has no session", async () => {
    getMapPoolState.mockResolvedValue(state({ session: null, reason: "not_configured" }));
    await mount();
    await open();

    expect(document.body.textContent).toContain(ROOM.empty.notConfiguredTitle);
    expect(document.body.textContent).toContain(ROOM.empty.notConfiguredHint);
  });

  it("renders the pool read-only, with team names and no selection", async () => {
    getMapPoolState.mockResolvedValue(
      state({
        pool: [
          entry({ id: 1, map_id: 21, status: "banned", action_index: 0 }),
          entry({ id: 2, map_id: 22, status: "available" })
        ],
        sequence: ["ban_home", "pick_away"]
      })
    );
    await mount();
    await open();

    expect(document.body.textContent).toContain("Hanamura");
    expect(document.body.textContent).toContain("Kings Row");
    expect(document.body.textContent).toContain("Bright Wolves vs Quiet Foxes");

    // Read-only: the available tile is not disabled by veto rules the way an
    // upcoming slot would be, but it must not be selectable — canSelect=false.
    const availableTile = Array.from(document.body.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("Kings Row")
    );
    expect(availableTile?.disabled).toBe(true);
  });

  // The bracket card used to spend two icons on one phase: this peek beside a
  // separate link into the pre-game room. Merged into one control, the room is
  // reachable from inside the peek — losing it would strand every captain who
  // opened the room from the bracket.
  it("carries the pre-game room link when the bracket passes one", async () => {
    getMapPoolState.mockResolvedValue(state({ session: null, reason: "not_configured" }));
    await mount({ roomHref: "/tournaments/7/pregame/4242?returnTo=%2Fbracket" });
    await open(en.bracket.viewPregame);

    const link = Array.from(document.body.querySelectorAll("a")).find((anchor) =>
      anchor.textContent?.includes(en.bracket.pregameRoom)
    );
    expect(link?.getAttribute("href")).toBe("/tournaments/7/pregame/4242?returnTo=%2Fbracket");
  });

  it("keeps the map-pool-only label when no room link is given", async () => {
    getMapPoolState.mockResolvedValue(state({ session: null, reason: "not_configured" }));
    await mount();
    await open();

    expect(
      Array.from(document.body.querySelectorAll("a")).some((anchor) =>
        anchor.textContent?.includes(en.bracket.pregameRoom)
      )
    ).toBe(false);
  });
});
