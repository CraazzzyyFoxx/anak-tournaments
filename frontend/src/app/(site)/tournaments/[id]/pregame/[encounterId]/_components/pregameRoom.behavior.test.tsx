// @vitest-environment happy-dom
//
// Covers the unified pre-game room's NEW contract over the retired
// VetoRoom/HeroBanRoom pair: the readiness gate (waiting screen, ready
// button, captain-only visibility) and sequential map -> hero phase
// selection. Grid/timeline grouping logic is already exhaustively covered by
// pick-ban-model.test.ts against the same unmodified components.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NextIntlClientProvider } from "next-intl";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import en from "@/i18n/messages/en.json";
import type { Encounter } from "@/types/encounter.types";
import type { PickBanEntry, PickBanSession, PickBanState } from "@/types/tournament.types";

import { PregameRoom } from "./PregameRoom";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const getPickBanState = vi.fn();
const performPickBanAction = vi.fn();
const markReady = vi.fn();
const getEncounter = vi.fn();
const getAllMaps = vi.fn();
const getAllHeroes = vi.fn();
const getMyRole = vi.fn();

vi.mock("@/services/pickBan.service", () => ({
  default: {
    getPickBanState: (...args: unknown[]) => getPickBanState(...args),
    performPickBanAction: (...args: unknown[]) => performPickBanAction(...args),
    markReady: (...args: unknown[]) => markReady(...args),
    electOpener: vi.fn(),
    reportMap: vi.fn(),
  },
}));
vi.mock("@/services/captain.service", () => ({
  default: { getMyRole: (...args: unknown[]) => getMyRole(...args) },
}));
vi.mock("@/services/encounter.service", () => ({
  default: { getEncounter: (...args: unknown[]) => getEncounter(...args) },
}));
vi.mock("@/services/map.service", () => ({
  default: { getAll: (...args: unknown[]) => getAllMaps(...args) },
}));
vi.mock("@/services/hero.service", () => ({
  default: { getAll: (...args: unknown[]) => getAllHeroes(...args) },
}));
vi.mock("@/hooks/useRealtimeTopic", () => ({ useRealtimeTopic: () => undefined }));
const usePermissionsMock = vi.fn(() => ({ isSuperuser: false, isWorkspaceAdmin: () => false, hasWorkspacePermission: () => false }));
vi.mock("@/hooks/usePermissions", () => ({
  usePermissions: () => usePermissionsMock(),
}));
vi.mock("@/lib/notify", () => ({
  notify: { apiError: vi.fn(), success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

const ROOM = en.pickBan.room;

const MAPS = [21, 22, 23].map((id) => ({ id, name: `Map ${id}`, image_path: "" }));
const HEROES = [101, 102, 103].map((id) => ({
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
    item_id: 21,
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
    kind: "map",
    status: "active",
    first_side: "home",
    awaiting_choice: false,
    pending_loser_side: null,
    seed_source: "bracket_slot",
    home_seed: 1,
    away_seed: 4,
    turn_timer_seconds: null,
    slot_reserves: null,
    started_at: "2026-08-01T10:00:00Z",
    current_step_started_at: null,
    ...overrides,
  };
}

function readyState(overrides: Partial<PickBanState>): PickBanState {
  return {
    session: session(),
    readiness: { home: true, away: true },
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

function unavailableState(reason: NonNullable<PickBanState["reason"]>, readiness = { home: false, away: false }): PickBanState {
  return {
    session: null,
    reason,
    readiness,
    sequence: [],
    pool: [],
    viewer_side: null,
    viewer_can_act: false,
    allowed_actions: [],
    current_step_index: null,
    current_step: null,
    expected_action: null,
    turn_side: null,
    current_round: null,
    is_complete: false,
  };
}

let container: HTMLDivElement;
let root: Root;
let scrollIntoView: Mock;

beforeEach(() => {
  vi.clearAllMocks();
  getAllMaps.mockResolvedValue({ results: MAPS });
  getAllHeroes.mockResolvedValue({ results: HEROES });
  getEncounter.mockResolvedValue(encounter());
  getMyRole.mockResolvedValue({ side: null });
  usePermissionsMock.mockReturnValue({ isSuperuser: false, isWorkspaceAdmin: () => false, hasWorkspacePermission: () => false });
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
          <PregameRoom encounterId={4242} />
        </NextIntlClientProvider>
      </QueryClientProvider>,
    );
  });
  await settle();
}

/** Routes `getPickBanState(kind, id)` mock calls to per-kind canned responses. */
function mockStates(map: PickBanState, hero: PickBanState) {
  getPickBanState.mockImplementation((kind: string) => Promise.resolve(kind === "map" ? map : hero));
}

describe("readiness gate", () => {
  it("shows the waiting screen when a configured kind reports not_ready", async () => {
    mockStates(unavailableState("not_ready"), unavailableState("not_configured"));
    await render();

    expect(document.body.textContent).toContain(ROOM.notReadyTitle);
    expect(document.body.textContent).toContain(ROOM.notReadyHint);
  });

  it("shows the ready button for a captain who has not confirmed yet", async () => {
    getMyRole.mockResolvedValue({ side: "home" });
    mockStates(
      unavailableState("not_ready", { home: false, away: true }),
      unavailableState("not_configured"),
    );
    await render();

    const button = Array.from(document.body.querySelectorAll("button")).find((b) => b.textContent?.trim() === ROOM.ready.button);
    expect(button).toBeTruthy();

    await act(async () => {
      button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await settle();

    expect(markReady).toHaveBeenCalledWith(4242);
  });

  it("shows a waiting-on-opponent message instead of a button once the viewer's own side is ready", async () => {
    getMyRole.mockResolvedValue({ side: "home" });
    mockStates(
      unavailableState("not_ready", { home: true, away: false }),
      unavailableState("not_configured"),
    );
    await render();

    expect(document.body.textContent).toContain(ROOM.ready.confirmed);
    expect(document.body.textContent).toContain(ROOM.ready.waitingOpponent);
    const button = Array.from(document.body.querySelectorAll("button")).find((b) => b.textContent?.trim() === ROOM.ready.button);
    expect(button).toBeUndefined();
  });

  it("hides the ready button entirely for a non-captain spectator", async () => {
    getMyRole.mockResolvedValue({ side: null });
    mockStates(unavailableState("not_ready"), unavailableState("not_configured"));
    await render();

    const button = Array.from(document.body.querySelectorAll("button")).find((b) => b.textContent?.trim() === ROOM.ready.button);
    expect(button).toBeUndefined();
  });
});

describe("closed-door copy", () => {
  it("shows the generic not-configured card when neither kind applies", async () => {
    mockStates(unavailableState("not_configured"), unavailableState("not_configured"));
    await render();

    expect(document.body.textContent).toContain(ROOM.notConfiguredTitle);
    expect(document.body.textContent).toContain(ROOM.notConfiguredHint);
  });

  it("surfaces a misconfigured map's own reason instead of skipping to hero", async () => {
    mockStates(unavailableState("slot_underfilled"), readyState({ session: session({ kind: "hero" }) }));
    await render();

    expect(document.body.textContent).toContain(ROOM.slotUnderfilledTitle);
  });
});

describe("phase selection", () => {
  it("renders the map phase first when both kinds are configured", async () => {
    mockStates(
      readyState({
        session: session({ kind: "map" }),
        sequence: ["ban_home", "ban_away"],
        pool: [entry({ id: 1, item_id: 21 }), entry({ id: 2, item_id: 22 })],
      }),
      readyState({ session: session({ kind: "hero" }) }),
    );
    await render();

    expect(document.body.textContent).toContain(ROOM.map.title);
    expect(document.body.textContent).toContain(`Map 21`);
    // Phase strip names both, current on map.
    expect(document.body.textContent).toContain(ROOM.phase.map);
    expect(document.body.textContent).toContain(ROOM.phase.hero);
  });

  it("advances to the hero phase once the map session is complete", async () => {
    mockStates(
      readyState({ session: session({ kind: "map" }), is_complete: true }),
      readyState({
        session: session({ kind: "hero" }),
        sequence: ["ban_home"],
        pool: [entry({ id: 3, item_id: 101 })],
      }),
    );
    await render();

    expect(document.body.textContent).toContain(ROOM.hero.title);
    expect(document.body.textContent).toContain(`Hero 101`);
  });

  it("goes straight to hero when the encounter has no map rule set at all", async () => {
    mockStates(
      unavailableState("not_configured"),
      readyState({ session: session({ kind: "hero" }), pool: [entry({ id: 3, item_id: 101 })] }),
    );
    await render();

    expect(document.body.textContent).toContain(ROOM.hero.title);
  });
});

describe("merged header layout", () => {
  it("keeps the room header inside the Map Pool card, with the first-pick note moved into Steps", async () => {
    mockStates(
      readyState({
        session: session({ kind: "map" }),
        sequence: ["ban_home", "ban_away"],
        pool: [entry({ id: 1, item_id: 21 }), entry({ id: 2, item_id: 22 })],
      }),
      readyState({ session: session({ kind: "hero" }) }),
    );
    await render();

    const cards = Array.from(document.body.querySelectorAll('[data-ui="card"]'));
    const poolCard = cards.find((card) => card.textContent?.includes(ROOM.map.title));
    const stepsCard = cards.find((card) => card.textContent?.includes(ROOM.steps.title));
    expect(poolCard).toBeTruthy();
    expect(stepsCard).toBeTruthy();
    expect(stepsCard).not.toBe(poolCard);

    // The former standalone header (back/title, team matchup) now lives inside the Map Pool card.
    expect(poolCard?.textContent).toContain(ROOM.title);
    expect(poolCard?.textContent).toContain("Bright Wolves");
    expect(poolCard?.textContent).toContain("Quiet Foxes");

    // "{team} goes first" moved out of the header and into the Steps card.
    const firstBanner = ROOM.firstBanner.replace("{team}", "Bright Wolves");
    expect(stepsCard?.textContent).toContain(firstBanner);
    expect(poolCard?.textContent).not.toContain(firstBanner);
  });
});

describe("captain actions", () => {
  it("sends a ban for the active phase's kind on confirm", async () => {
    mockStates(
      readyState({
        session: session({ kind: "map" }),
        sequence: ["ban_home"],
        pool: [entry({ id: 1, item_id: 21 })],
        turn_side: "home",
        expected_action: "ban",
        viewer_can_act: true,
        allowed_actions: ["ban"],
      }),
      unavailableState("not_configured"),
    );
    performPickBanAction.mockResolvedValue(entry({ id: 1, item_id: 21, status: "banned" }));
    await render();

    const tile = Array.from(container.querySelectorAll("button")).find((b) => b.textContent?.includes("Map 21"));
    await act(async () => {
      tile?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await settle();

    const confirm = Array.from(container.querySelectorAll("button")).find((b) => b.textContent?.includes("Map 21") && b.textContent?.toLowerCase().includes("ban"));
    await act(async () => {
      confirm?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await settle();

    expect(performPickBanAction).toHaveBeenCalledWith("map", 4242, { item_id: 21, action: "ban" });
  });
});

describe("admin controls", () => {
  it("renders the reset/act panel for a workspace admin, with protect offered when the sequence uses it", async () => {
    usePermissionsMock.mockReturnValue({ isSuperuser: true, isWorkspaceAdmin: () => true, hasWorkspacePermission: () => true });
    mockStates(
      unavailableState("not_configured"),
      readyState({
        session: session({ kind: "hero" }),
        sequence: ["ban_home", "protect_away", "pick_home"],
        pool: [entry({ id: 1, item_id: 101 })],
      }),
    );
    await render();

    expect(document.body.textContent).toContain(ROOM.admin.title);
    expect(document.body.textContent).toContain(ROOM.action.protect);
  });

  it("omits the reset/act panel for a non-admin captain", async () => {
    mockStates(
      unavailableState("not_configured"),
      readyState({ session: session({ kind: "hero" }), sequence: ["ban_home"], pool: [entry({ id: 1, item_id: 101 })] }),
    );
    await render();

    expect(document.body.textContent).not.toContain(ROOM.admin.title);
  });
});
