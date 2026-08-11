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
    reportMap: vi.fn()
  }
}));
vi.mock("@/services/captain.service", () => ({
  default: { getMyRole: (...args: unknown[]) => getMyRole(...args) }
}));
vi.mock("@/services/encounter.service", () => ({
  default: { getEncounter: (...args: unknown[]) => getEncounter(...args) }
}));
vi.mock("@/services/map.service", () => ({
  default: { getAll: (...args: unknown[]) => getAllMaps(...args) }
}));
vi.mock("@/services/hero.service", () => ({
  default: { getAll: (...args: unknown[]) => getAllHeroes(...args) }
}));
vi.mock("@/hooks/useRealtimeTopic", () => ({ useRealtimeTopic: () => undefined }));
const usePermissionsMock = vi.fn(() => ({
  isSuperuser: false,
  isWorkspaceAdmin: () => false,
  hasWorkspacePermission: () => false
}));
vi.mock("@/hooks/usePermissions", () => ({
  usePermissions: () => usePermissionsMock()
}));
vi.mock("@/lib/notify", () => ({
  notify: { apiError: vi.fn(), success: vi.fn(), error: vi.fn(), info: vi.fn() }
}));

const ROOM = en.pickBan.room;

const MAPS = [21, 22, 23].map((id) => ({ id, name: `Map ${id}`, image_path: "" }));
const HEROES = [101, 102, 103].map((id) => ({
  id,
  name: `Hero ${id}`,
  slug: `hero-${id}`,
  image_path: "",
  type: "Damage",
  role: "damage"
}));

function encounter(): Encounter {
  return {
    id: 4242,
    home_team: { id: 7, name: "Bright Wolves" },
    away_team: { id: 8, name: "Quiet Foxes" },
    tournament: { id: 3, workspace_id: 1 }
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
    ...overrides
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
    ...overrides
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
    ...overrides
  };
}

function unavailableState(
  reason: NonNullable<PickBanState["reason"]>,
  readiness = { home: false, away: false }
): PickBanState {
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
    is_complete: false
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
  usePermissionsMock.mockReturnValue({
    isSuperuser: false,
    isWorkspaceAdmin: () => false,
    hasWorkspacePermission: () => false
  });
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
      </QueryClientProvider>
    );
  });
  await settle();
}

/** Routes `getPickBanState(kind, id)` mock calls to per-kind canned responses. */
function mockStates(map: PickBanState, hero: PickBanState) {
  getPickBanState.mockImplementation((kind: string) =>
    Promise.resolve(kind === "map" ? map : hero)
  );
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
      unavailableState("not_configured")
    );
    await render();

    const button = Array.from(document.body.querySelectorAll("button")).find(
      (b) => b.textContent?.trim() === ROOM.ready.button
    );
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
      unavailableState("not_configured")
    );
    await render();

    expect(document.body.textContent).toContain(ROOM.ready.confirmed);
    expect(document.body.textContent).toContain(ROOM.ready.waitingOpponent);
    const button = Array.from(document.body.querySelectorAll("button")).find(
      (b) => b.textContent?.trim() === ROOM.ready.button
    );
    expect(button).toBeUndefined();
  });

  it("hides the ready button entirely for a non-captain spectator", async () => {
    getMyRole.mockResolvedValue({ side: null });
    mockStates(unavailableState("not_ready"), unavailableState("not_configured"));
    await render();

    const button = Array.from(document.body.querySelectorAll("button")).find(
      (b) => b.textContent?.trim() === ROOM.ready.button
    );
    expect(button).toBeUndefined();
  });

  it("renders the real room behind the gate — matchup and per-side state, no skeletons", async () => {
    getMyRole.mockResolvedValue({ side: "home" });
    mockStates(
      unavailableState("not_ready", { home: true, away: false }),
      unavailableState("not_configured")
    );
    await render();

    // The header is real, not a placeholder: both teams are on screen.
    expect(document.body.textContent).toContain("Bright Wolves");
    expect(document.body.textContent).toContain("Quiet Foxes");
    // Each side says where it stands, rather than one modal line for both.
    expect(document.body.textContent).toContain(ROOM.ready.stateReady);
    expect(document.body.textContent).toContain(ROOM.ready.statePending);
    // Nothing pretends to be loading: this state only clears when a human in
    // another browser confirms, so a shimmer would never resolve.
    expect(document.body.querySelector(".animate-pulse")).toBeNull();
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
    mockStates(
      unavailableState("slot_underfilled"),
      readyState({ session: session({ kind: "hero" }) })
    );
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
        pool: [entry({ id: 1, item_id: 21 }), entry({ id: 2, item_id: 22 })]
      }),
      readyState({ session: session({ kind: "hero" }) })
    );
    await render();

    expect(document.body.textContent).toContain(ROOM.map.title);
    expect(document.body.textContent).toContain(`Map 21`);
    // Phase strip names all three steps of the round, current on map.
    expect(document.body.textContent).toContain(ROOM.phase.map);
    expect(document.body.textContent).toContain(ROOM.phase.hero);
    expect(document.body.textContent).toContain(ROOM.phase.report);
  });

  it("advances to the hero phase once this round's map is picked", async () => {
    mockStates(
      readyState({
        session: session({ kind: "map" }),
        is_complete: true,
        pool: [entry({ id: 1, item_id: 21, round: 1, status: "picked", action_index: 2 })]
      }),
      readyState({
        session: session({ kind: "hero" }),
        sequence: ["ban_home"],
        pool: [entry({ id: 3, item_id: 101, round: 1 })]
      })
    );
    await render();

    expect(document.body.textContent).toContain(ROOM.hero.title);
    // Hero Pool tiles are icon-only now -- the name surfaces as the button's
    // accessible name/tooltip, not as visible text content.
    expect(document.body.querySelector('button[title="Hero 101"]')).toBeTruthy();
  });

  it("asks for the map's result once its heroes are banned", async () => {
    mockStates(
      readyState({
        session: session({ kind: "map" }),
        is_complete: true,
        viewer_side: "home",
        pool: [entry({ id: 1, item_id: 21, round: 1, status: "picked", action_index: 2 })]
      }),
      readyState({
        session: session({ kind: "hero" }),
        is_complete: true,
        sequence: ["ban_home"],
        pool: [entry({ id: 3, item_id: 101, round: 1, status: "banned" })]
      })
    );
    await render();

    expect(document.body.textContent).toContain("Map 21");
    expect(document.body.textContent).toContain(ROOM.mapResult.report);
    // Neither side has filed yet, and no score is on screen to copy.
    expect(document.body.textContent).toContain(
      ROOM.mapResult.pending.replace("{team}", "Bright Wolves")
    );
  });

  it("shows the viewer their own filed score while the opponent's stays sealed", async () => {
    // Two independent claims that reconcile: revealing the first would turn the
    // second into a copy of it. The viewer's own numbers are theirs already.
    mockStates(
      readyState({
        session: session({ kind: "map" }),
        is_complete: true,
        viewer_side: "home",
        pool: [entry({ id: 1, item_id: 21, round: 1, status: "picked", action_index: 2 })],
        map_reports: [{ map_id: 21, side: "home", home_score: 3, away_score: 1 }]
      }),
      readyState({
        session: session({ kind: "hero" }),
        is_complete: true,
        sequence: ["ban_home"],
        pool: [entry({ id: 3, item_id: 101, round: 1, status: "banned" })]
      })
    );
    await render();

    // Own claim carries the digits the viewer typed; the opponent has filed
    // nothing, so its tile is the empty "waiting" state and the verdict still
    // reads "awaiting both".
    const claims = Array.from(document.body.querySelectorAll<HTMLElement>("[data-claim]"));
    expect(claims.map((tile) => tile.dataset.claim)).toEqual(["filed", "waiting"]);
    const visibleSlab = (tile: HTMLElement) =>
      Array.from(tile.querySelectorAll<HTMLElement>(".tabular-nums"))
        .map((slab) => slab.textContent ?? "")
        .join("");
    expect(visibleSlab(claims[0])).toBe("3:1");
    expect(visibleSlab(claims[1])).toBe("?:?");
    expect(document.body.textContent).toContain(ROOM.mapResult.verdict.waiting);
    expect(document.body.textContent).toContain(ROOM.mapResult.amend);
  });

  it("charts every settled map of the series with its confirmed score", async () => {
    getEncounter.mockResolvedValue({
      ...encounter(),
      best_of: 3,
      score: { home: 1, away: 0 },
      matches: [{ map_id: 21, map_index: 1, score: { home: 3, away: 1 } }]
    } as unknown as Encounter);
    mockStates(
      readyState({
        session: session({ kind: "map" }),
        is_complete: true,
        viewer_side: "home",
        pool: [
          entry({ id: 1, item_id: 21, round: 1, status: "played", action_index: 2 }),
          entry({ id: 2, item_id: 22, round: 2, status: "picked", action_index: 5 })
        ]
      }),
      readyState({
        session: session({ kind: "hero" }),
        is_complete: true,
        sequence: ["ban_home"],
        pool: [entry({ id: 3, item_id: 101, round: 2, status: "banned" })]
      })
    );
    await render();

    const strip = document.body.querySelector(`ol[aria-label="${ROOM.series.label}"]`);
    expect(strip).toBeTruthy();
    // Map 1 is settled and carries its confirmed score; map 2 is the one whose
    // result the loop is still waiting on.
    const items = Array.from(strip?.querySelectorAll("li") ?? []);
    expect(items).toHaveLength(2);
    expect(items[0].textContent).toContain("Map 21");
    expect(items[0].textContent).toContain("3:1");
    expect(items[1].textContent).toContain("Map 22");
    expect(items[1].textContent).toContain(ROOM.series.awaiting);
    expect(items[1].textContent).not.toMatch(/\d:\d/);
  });

  it("never scores a map the series has not played, even with a Match row for it", async () => {
    // The regression: `Match` rows exist for maps a log parser touched or that
    // were pre-created at 0:0, so keying "settled" off `match != null` printed
    // a 0:0 nobody scored on an unreached map — and a score on the very map the
    // panel below was still asking both captains to report.
    getEncounter.mockResolvedValue({
      ...encounter(),
      best_of: 3,
      score: { home: 0, away: 0 },
      matches: [
        { map_id: 21, map_index: 1, score: { home: 1, away: 0 } },
        { map_id: 23, map_index: 3, score: { home: 0, away: 0 } }
      ]
    } as unknown as Encounter);
    mockStates(
      readyState({
        session: session({ kind: "map" }),
        is_complete: true,
        viewer_side: "home",
        // A slots veto settles the whole series at once: all three are `picked`,
        // none `played`. Map 21 is the one being played and reported right now.
        pool: [
          entry({ id: 1, item_id: 21, round: 1, status: "picked", action_index: 2 }),
          entry({ id: 2, item_id: 22, round: 2, status: "picked", action_index: 5 }),
          entry({ id: 3, item_id: 23, round: 3, status: "picked", action_index: 8 })
        ]
      }),
      readyState({
        session: session({ kind: "hero" }),
        is_complete: true,
        sequence: ["ban_home"],
        pool: [entry({ id: 4, item_id: 101, round: 1, status: "banned" })]
      })
    );
    await render();

    const items = Array.from(
      document.body.querySelectorAll(`ol[aria-label="${ROOM.series.label}"] li`)
    );
    expect(items).toHaveLength(3);
    // Not one of them is settled, so not one of them shows digits — including
    // map 21 and map 23, which both HAVE a Match row.
    for (const item of items) expect(item.textContent).not.toMatch(/\d:\d/);
    // Only the first unplayed map is the one being awaited; the rest are simply
    // maps of the series that have not been reached.
    expect(items[0].textContent).toContain(ROOM.series.awaiting);
    expect(items[1].textContent).toContain(ROOM.series.upcoming);
    expect(items[2].textContent).toContain(ROOM.series.upcoming);
  });

  it("stays on the hero phase while the hero round for the pending map is still catching up", async () => {
    // Map 2 was just picked; the hero session still only holds round 1, whose
    // steps are all taken. Jumping to "report" here would skip map 2's bans.
    mockStates(
      readyState({
        session: session({ kind: "map" }),
        is_complete: true,
        pool: [
          entry({ id: 1, item_id: 21, round: 1, status: "played", action_index: 2 }),
          entry({ id: 2, item_id: 22, round: 2, status: "picked", action_index: 5 })
        ]
      }),
      readyState({
        session: session({ kind: "hero" }),
        is_complete: true,
        sequence: ["ban_home"],
        pool: [entry({ id: 3, item_id: 101, round: 1, status: "banned" })]
      })
    );
    await render();

    expect(document.body.textContent).toContain(ROOM.hero.title);
    expect(document.body.textContent).not.toContain(ROOM.mapResult.report);
  });

  it("reports the series as settled once nothing is left to pick, ban or report", async () => {
    mockStates(
      readyState({
        session: session({ kind: "map" }),
        is_complete: true,
        pool: [entry({ id: 1, item_id: 21, round: 1, status: "played", action_index: 2 })]
      }),
      readyState({
        session: session({ kind: "hero" }),
        is_complete: true,
        sequence: ["ban_home"],
        pool: [entry({ id: 3, item_id: 101, round: 1, status: "banned" })]
      })
    );
    await render();

    expect(document.body.textContent).toContain(ROOM.seriesDone.title);
  });

  it("goes straight to hero when the encounter has no map rule set at all", async () => {
    mockStates(
      unavailableState("not_configured"),
      readyState({ session: session({ kind: "hero" }), pool: [entry({ id: 3, item_id: 101 })] })
    );
    await render();

    expect(document.body.textContent).toContain(ROOM.hero.title);
  });

  it("holds the hero phase closed until the map it bans for is known", async () => {
    mockStates(
      readyState({
        session: session({ kind: "map" }),
        sequence: ["ban_home"],
        is_complete: true,
        pool: [entry({ id: 1, item_id: 21, round: 1, status: "picked", action_index: 1 })]
      }),
      unavailableState("waiting_map", { home: true, away: true })
    );
    await render();

    expect(document.body.textContent).toContain(ROOM.waitingMapTitle);
  });
});

describe("merged header layout", () => {
  it("keeps the room header inside the Map Pool card, with the first-pick note moved into Steps", async () => {
    mockStates(
      readyState({
        session: session({ kind: "map" }),
        sequence: ["ban_home", "ban_away"],
        pool: [entry({ id: 1, item_id: 21 }), entry({ id: 2, item_id: 22 })]
      }),
      readyState({ session: session({ kind: "hero" }) })
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

describe("Hero Pool tile redesign", () => {
  it("filters icon-only hero tiles by role via the Filters chip group", async () => {
    getAllHeroes.mockResolvedValue({
      results: [
        { id: 101, name: "Ana", slug: "ana", image_path: "", type: "Support", role: "support" },
        {
          id: 102,
          name: "Reinhardt",
          slug: "reinhardt",
          image_path: "",
          type: "Tank",
          role: "tank"
        }
      ]
    });
    mockStates(
      unavailableState("not_configured"),
      readyState({
        session: session({ kind: "hero" }),
        sequence: ["ban_home", "ban_away"],
        pool: [entry({ id: 1, item_id: 101 }), entry({ id: 2, item_id: 102 })]
      })
    );
    await render();

    expect(document.body.querySelector('button[title="Ana"]')).toBeTruthy();
    expect(document.body.querySelector('button[title="Reinhardt"]')).toBeTruthy();

    const filterGroup = document.body.querySelector('[role="group"][aria-label="Filters"]');
    expect(filterGroup).toBeTruthy();
    const tankChip = Array.from(filterGroup!.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("Tank")
    );
    expect(tankChip).toBeTruthy();

    await act(async () => {
      tankChip!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await settle();

    expect(document.body.querySelector('button[title="Reinhardt"]')).toBeTruthy();
    expect(document.body.querySelector('button[title="Ana"]')).toBeFalsy();
  });

  it("crosses out an unavailable hero tile instead of a status badge", async () => {
    mockStates(
      unavailableState("not_configured"),
      readyState({
        session: session({ kind: "hero" }),
        pool: [
          entry({ id: 1, item_id: 101, status: "available" }),
          entry({ id: 2, item_id: 102, status: "banned" })
        ]
      })
    );
    await render();

    const availableTile = document.body.querySelector('button[title="Hero 101"]');
    const bannedTile = document.body.querySelector('button[title="Hero 102"]');
    expect(availableTile?.querySelector("svg.lucide-ban")).toBeFalsy();
    expect(bannedTile?.querySelector("svg.lucide-ban")).toBeTruthy();
    // Icon-only tile: no visible status badge/name text (unlike the old badge
    // footer) -- only the fallback-avatar initials can legitimately show.
    expect(bannedTile?.textContent).not.toContain("Banned");
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
        allowed_actions: ["ban"]
      }),
      unavailableState("not_configured")
    );
    performPickBanAction.mockResolvedValue(entry({ id: 1, item_id: 21, status: "banned" }));
    await render();

    const tile = Array.from(container.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("Map 21")
    );
    await act(async () => {
      tile?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await settle();

    const confirm = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent?.includes("Map 21") && b.textContent?.toLowerCase().includes("ban")
    );
    await act(async () => {
      confirm?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await settle();

    expect(performPickBanAction).toHaveBeenCalledWith("map", 4242, { item_id: 21, action: "ban" });
  });
});

describe("admin controls", () => {
  it("renders the reset/act panel for a workspace admin, with protect offered when the sequence uses it", async () => {
    usePermissionsMock.mockReturnValue({
      isSuperuser: true,
      isWorkspaceAdmin: () => true,
      hasWorkspacePermission: () => true
    });
    mockStates(
      unavailableState("not_configured"),
      readyState({
        session: session({ kind: "hero" }),
        sequence: ["ban_home", "protect_away", "pick_home"],
        pool: [entry({ id: 1, item_id: 101 })]
      })
    );
    await render();

    expect(document.body.textContent).toContain(ROOM.admin.title);
    expect(document.body.textContent).toContain(ROOM.action.protect);
  });

  it("omits the reset/act panel for a non-admin captain", async () => {
    mockStates(
      unavailableState("not_configured"),
      readyState({
        session: session({ kind: "hero" }),
        sequence: ["ban_home"],
        pool: [entry({ id: 1, item_id: 101 })]
      })
    );
    await render();

    expect(document.body.textContent).not.toContain(ROOM.admin.title);
  });
});
