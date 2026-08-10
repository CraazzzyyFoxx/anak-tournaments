// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NextIntlClientProvider } from "next-intl";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import en from "@/i18n/messages/en.json";
import type { Encounter } from "@/types/encounter.types";
import type { PickBanEntry, PickBanSession, PickBanState, VetoUnavailableReason } from "@/types/tournament.types";

import { HeroBanRoom } from "./HeroBanRoom";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const getHeroPoolState = vi.fn();
const performHeroVeto = vi.fn();
const electOpener = vi.fn();
const getEncounter = vi.fn();
const getAllHeroes = vi.fn();

vi.mock("@/services/pickBan.service", () => ({
  default: {
    getHeroPoolState: (...args: unknown[]) => getHeroPoolState(...args),
    performHeroVeto: (...args: unknown[]) => performHeroVeto(...args),
    electOpener: (...args: unknown[]) => electOpener(...args),
  },
}));
vi.mock("@/services/encounter.service", () => ({
  default: { getEncounter: (...args: unknown[]) => getEncounter(...args) },
}));
vi.mock("@/services/hero.service", () => ({
  default: { getAll: (...args: unknown[]) => getAllHeroes(...args) },
}));
vi.mock("@/hooks/useRealtimeTopic", () => ({ useRealtimeTopic: () => undefined }));
vi.mock("@/lib/notify", () => ({
  notify: { apiError: vi.fn(), success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

const ROOM = en.pickBan.room;

const HEROES = [101, 102, 103, 104].map((id) => ({
  id,
  name: `Hero ${id}`,
  slug: `hero-${id}`,
  image_path: "",
  type: "Damage",
  role: "damage",
}));

function encounter(): Encounter {
  return {
    id: 4242,
    home_team: { id: 7, name: "Bright Wolves" },
    away_team: { id: 8, name: "Quiet Foxes" },
    tournament: { id: 3, workspace_id: 1 },
  } as unknown as Encounter;
}

function entry(overrides: Partial<PickBanEntry>): PickBanEntry {
  return {
    id: 1,
    item_id: 101,
    round: null,
    order: 0,
    action_index: null,
    picked_by: null,
    protected_by: null,
    team_id: null,
    status: "available",
    ...overrides,
  };
}

function session(overrides: Partial<PickBanSession> = {}): PickBanSession {
  return {
    id: 1,
    kind: "hero",
    status: "active",
    first_side: "home",
    awaiting_choice: false,
    pending_loser_side: null,
    seed_source: "bracket_slot",
    home_seed: 1,
    away_seed: 4,
    turn_timer_seconds: null,
    started_at: "2026-08-01T10:00:00Z",
    current_step_started_at: null,
    ...overrides,
  };
}

function state(overrides: Partial<PickBanState>): PickBanState {
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
    current_round: null,
    is_complete: false,
    ...overrides,
  };
}

let container: HTMLDivElement;
let root: Root;
let scrollIntoView: Mock;

beforeEach(() => {
  vi.clearAllMocks();
  getEncounter.mockResolvedValue(encounter());
  getAllHeroes.mockResolvedValue({ results: HEROES });
  scrollIntoView = vi.fn();
  Element.prototype.scrollIntoView = scrollIntoView;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

async function settle(ticks = 3) {
  for (let index = 0; index < ticks; index += 1) {
    await act(async () => {
      const { promise, resolve } = Promise.withResolvers<void>();
      setTimeout(resolve, 0);
      await promise;
    });
  }
}

async function render() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => {
    root.render(
      <QueryClientProvider client={client}>
        <NextIntlClientProvider locale="en" messages={en}>
          <HeroBanRoom encounterId={4242} />
        </NextIntlClientProvider>
      </QueryClientProvider>,
    );
  });
  await settle();
}

describe("closed-door copy", () => {
  const CASES: ReadonlyArray<[VetoUnavailableReason, string, string]> = [
    ["not_configured", ROOM.notConfiguredTitle, ROOM.notConfiguredHint],
    ["teams_unknown", ROOM.teamsUnknownTitle, ROOM.teamsUnknownHint],
    ["slot_count_mismatch", ROOM.slotCountMismatchTitle, ROOM.slotCountMismatchHint],
    ["slot_underfilled", ROOM.slotUnderfilledTitle, ROOM.slotUnderfilledHint],
  ];

  it.each(CASES)("renders %s with its own title and hint", async (reason, title, hint) => {
    getHeroPoolState.mockResolvedValue(state({ session: null, reason }));
    await render();

    expect(container.textContent).toContain(title);
    expect(container.textContent).toContain(hint);
  });
});

describe("active hero-ban room", () => {
  const liveState = (overrides: Partial<PickBanState> = {}) =>
    state({
      sequence: ["ban_home", "ban_away", "decider"],
      pool: [
        entry({ id: 1, item_id: 101 }),
        entry({ id: 2, item_id: 102 }),
        entry({ id: 3, item_id: 103 }),
      ],
      current_step_index: 0,
      expected_action: "ban",
      turn_side: "home",
      viewer_can_act: true,
      allowed_actions: ["ban"],
      ...overrides,
    });

  it("renders every available hero as a selectable tile", async () => {
    getHeroPoolState.mockResolvedValue(liveState());
    await render();

    expect(container.textContent).toContain("Hero 101");
    expect(container.textContent).toContain("Hero 102");
    expect(container.textContent).toContain("Hero 103");
  });

  it("lets the acting captain select then confirm a ban", async () => {
    getHeroPoolState.mockResolvedValue(liveState());
    performHeroVeto.mockResolvedValue(entry({ item_id: 101, status: "banned" }));
    await render();

    const heroButton = [...container.querySelectorAll("button")].find((b) => b.textContent?.includes("Hero 101"));
    expect(heroButton).toBeDefined();
    await act(async () => heroButton!.click());
    await settle();

    const confirmButton = [...container.querySelectorAll("button")].find((b) =>
      b.textContent?.includes(ROOM.captain.confirmBan.replace("{item}", "Hero 101")),
    );
    expect(confirmButton).toBeDefined();
    await act(async () => confirmButton!.click());
    await settle();

    expect(performHeroVeto).toHaveBeenCalledWith(4242, { item_id: 101, action: "ban" });
  });

  it("shows the elect-opener dialog only to the losing captain", async () => {
    getHeroPoolState.mockResolvedValue(
      liveState({
        session: session({ awaiting_choice: true, pending_loser_side: "home" }),
        turn_side: null,
        expected_action: null,
        viewer_can_act: false,
        allowed_actions: [],
        viewer_side: "home",
      }),
    );
    await render();

    expect(document.body.textContent).toContain(ROOM.electOpener.title);
  });

  it("hides the elect-opener dialog from the winning captain", async () => {
    getHeroPoolState.mockResolvedValue(
      liveState({
        session: session({ awaiting_choice: true, pending_loser_side: "away" }),
        turn_side: null,
        expected_action: null,
        viewer_can_act: false,
        allowed_actions: [],
        viewer_side: "home",
      }),
    );
    await render();

    expect(document.body.textContent).not.toContain(ROOM.electOpener.title);
  });
});
