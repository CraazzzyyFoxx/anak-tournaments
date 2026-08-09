// @vitest-environment happy-dom
//
// The room used to decide its closed-door copy with
// `const teamsUnknown = state.reason === "teams_unknown"`, and three ternaries
// hung off that boolean. TypeScript never objected — comparing a widened union
// against one literal is legal — so from the moment the backend could answer
// `slot_count_mismatch` or `slot_underfilled`, both rendered "Veto is not
// configured / check back later": a captain told to wait out a config that only
// the organizer can fix.
//
// Slot mode also adds three states the flat room never had, and each one is a
// way to mislead a captain rather than a cosmetic gap:
//   1. every slot survivor is committed as `picked` / `picked_by: "decider"`, so
//      the status badge credits a team that picked nothing;
//   2. an upcoming slot's candidate is `available` AND unselectable — a pair flat
//      mode cannot produce, so it looks live and silently ignores clicks;
//   3. `current_slot` returns to null when a slot veto finishes, exactly as in
//      flat mode, so anything reading mode off it renders a finished slot veto
//      as flat.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NextIntlClientProvider } from "next-intl";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import en from "@/i18n/messages/en.json";
import type { Encounter } from "@/types/encounter.types";
import type {
  EncounterMapPoolEntry,
  EncounterMapPoolState,
  EncounterVetoSession,
  VetoUnavailableReason,
} from "@/types/tournament.types";

import { VetoRoom } from "./VetoRoom";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const getMapPoolState = vi.fn();
const performVeto = vi.fn();
const getEncounter = vi.fn();
const getAllMaps = vi.fn();

vi.mock("@/services/captain.service", () => ({
  default: {
    getMapPoolState: (...args: unknown[]) => getMapPoolState(...args),
    performVeto: (...args: unknown[]) => performVeto(...args)
  }
}));
vi.mock("@/services/encounter.service", () => ({
  default: { getEncounter: (...args: unknown[]) => getEncounter(...args) }
}));
vi.mock("@/services/map.service", () => ({
  default: { getAll: (...args: unknown[]) => getAllMaps(...args) }
}));
vi.mock("@/hooks/usePermissions", () => ({
  usePermissions: () => ({
    isSuperuser: false,
    isWorkspaceAdmin: () => false,
    hasWorkspacePermission: () => false
  })
}));
vi.mock("@/hooks/useRealtimeTopic", () => ({ useRealtimeTopic: () => undefined }));
vi.mock("@/lib/notify", () => ({ notify: { apiError: vi.fn(), success: vi.fn(), error: vi.fn() } }));
vi.mock("next/image", () => ({
  // eslint-disable-next-line @next/next/no-img-element -- this IS the next/image stand-in
  default: ({ alt }: { alt: string }) => <img alt={alt} />
}));

const ROOM = en.encounters.veto.room;

/**
 * Nine pool maps plus two reserves, all with ids deliberately NOT 1..11 and
 * never equal to a slot number, so nothing can pass by confusing a map id with
 * a slot or an index. 84 and 26 are the reserves and are candidates of nothing,
 * so a label that named a candidate — or a candidate tile that borrowed the
 * reserve's name — reads as wrong rather than as plausible.
 */
const MAPS = [21, 22, 23, 26, 32, 33, 41, 42, 43, 44, 84].map((id) => ({
  id,
  name: `Map ${id}`,
  image_path: null,
  gamemode_id: 1,
  in_competitive: true
}));

function encounter(): Encounter {
  return {
    id: 4242,
    home_team: { id: 7, name: "Bright Wolves" },
    away_team: { id: 8, name: "Quiet Foxes" },
    tournament: { id: 3, workspace_id: 1 }
  } as unknown as Encounter;
}

/**
 * Every field of `EncounterMapPoolEntry` is spelled out here rather than spread
 * from a caller: `tsconfig.json` excludes test files, so a builder that drops a
 * required field type-checks green and silently feeds the component a hole.
 */
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

/** Spelled out for the same reason `entry` is: test files are unchecked. */
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

/**
 * A three-slot Bo3 in slot mode. Positions are 2, 5 and 9 — gapped, and never a
 * 0- or 1-based index; candidate counts are 3, 2 and 4, all different from each
 * other, from the group count and from every position; the live slot is 5, the
 * MIDDLE one, so "first" and "last" both fail. Slot 2 has resolved to a
 * survivor, slot 5 is mid-ban, slot 9 has not opened.
 */
function slotPool(): EncounterMapPoolEntry[] {
  return [
    entry({ id: 71, map_id: 41, slot: 9, order: 6 }),
    entry({ id: 62, map_id: 33, slot: 5, order: 4 }),
    entry({ id: 53, map_id: 21, slot: 2, order: 1, status: "picked", picked_by: "decider", action_index: 2 }),
    entry({ id: 74, map_id: 42, slot: 9, order: 7 }),
    entry({ id: 51, map_id: 22, slot: 2, order: 2, status: "banned", action_index: 0 }),
    entry({ id: 75, map_id: 43, slot: 9, order: 8 }),
    entry({ id: 61, map_id: 32, slot: 5, order: 3, status: "banned", action_index: 3 }),
    entry({ id: 52, map_id: 23, slot: 2, order: 5, status: "banned", action_index: 1 }),
    entry({ id: 76, map_id: 44, slot: 9, order: 9 })
  ];
}

/** Nine steps: slot 2 spends 3, slot 5 spends 2, slot 9 spends 4. */
const SLOT_SEQUENCE = [
  "ban_home",
  "ban_away",
  "decider",
  "ban_home",
  "decider",
  "ban_away",
  "ban_home",
  "ban_away",
  "decider"
];

let container: HTMLDivElement;
let root: Root;
let scrollIntoView: Mock;

beforeEach(() => {
  vi.clearAllMocks();
  getEncounter.mockResolvedValue(encounter());
  getAllMaps.mockResolvedValue({ results: MAPS });
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

async function render() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => {
    root.render(
      <QueryClientProvider client={client}>
        <NextIntlClientProvider locale="en" messages={en}>
          <VetoRoom encounterId={4242} />
        </NextIntlClientProvider>
      </QueryClientProvider>
    );
  });
  await settle();
}

/** Every map tile, keyed by the map name its button renders. */
function tiles(): Map<string, HTMLButtonElement> {
  const byName = new Map<string, HTMLButtonElement>();
  for (const button of container.querySelectorAll("button")) {
    const label = button.querySelector("span.truncate")?.textContent?.trim();
    if (label) byName.set(label, button as HTMLButtonElement);
  }
  return byName;
}

describe("closed-door copy", () => {
  /** One case per `VetoUnavailableReason`, so a shared string shows up here. */
  const CASES: ReadonlyArray<[VetoUnavailableReason, string, string]> = [
    ["not_configured", ROOM.empty.notConfiguredTitle, ROOM.empty.notConfiguredHint],
    ["teams_unknown", ROOM.empty.teamsUnknownTitle, ROOM.empty.teamsUnknownHint],
    ["slot_count_mismatch", ROOM.empty.slotCountMismatchTitle, ROOM.empty.slotCountMismatchHint],
    ["slot_underfilled", ROOM.empty.slotUnderfilledTitle, ROOM.empty.slotUnderfilledHint]
  ];

  it.each(CASES)("renders %s with its own title and hint", async (reason, title, hint) => {
    getMapPoolState.mockResolvedValue(state({ session: null, reason }));
    await render();

    expect(container.textContent).toContain(title);
    expect(container.textContent).toContain(hint);
  });

  // One case per test rather than a loop over `render()`: a second render on the
  // same root can leave the first case's DOM standing, and a loop that never
  // reaches its second subject passes for the wrong reason.
  it.each(["slot_count_mismatch", "slot_underfilled"] as const)(
    "never tells a %s room to check back later",
    async (reason) => {
      getMapPoolState.mockResolvedValue(state({ session: null, reason }));
      await render();

      expect(container.textContent).not.toContain(ROOM.empty.notConfiguredTitle);
      expect(container.textContent).not.toContain(ROOM.empty.notConfiguredHint);
    },
  );

  it("falls back to not_configured only when the server names no reason", async () => {
    getMapPoolState.mockResolvedValue(state({ session: null }));
    await render();

    expect(container.textContent).toContain(ROOM.empty.notConfiguredTitle);
  });
});

describe("slot-mode map grid", () => {
  const liveState = (overrides: Partial<EncounterMapPoolState> = {}) =>
    state({
      sequence: SLOT_SEQUENCE,
      pool: slotPool(),
      current_slot: 5,
      current_step_index: 4,
      expected_action: "ban",
      turn_side: "home",
      viewer_can_act: true,
      allowed_actions: ["ban"],
      ...overrides
    });

  it("labels every slot by its own gapped position", async () => {
    getMapPoolState.mockResolvedValue(liveState());
    await render();

    for (const n of [2, 5, 9]) {
      expect(container.textContent).toContain(ROOM.slot.label.replace("{n}", String(n)));
    }
    // The three groups are 2/5/9, so a label for slot 1 or 3 would mean the code
    // numbered them by list position.
    expect(container.textContent).not.toContain(ROOM.slot.label.replace("{n}", "1"));
    expect(container.textContent).not.toContain(ROOM.slot.label.replace("{n}", "3"));
  });

  it("calls a slot survivor Remaining, never Picked", async () => {
    getMapPoolState.mockResolvedValue(liveState());
    await render();

    const survivor = tiles().get("Map 21");
    expect(survivor).toBeDefined();
    expect(survivor!.textContent).toContain(ROOM.maps.status.remaining);
    expect(survivor!.textContent).not.toContain(ROOM.maps.status.picked);
    // Slot mode drops the "· decider" marker from the order list — every
    // survivor is one there — and `entry.slot == null` is the only thing
    // scoping that to slot mode.
    expect(container.textContent).not.toContain(`· ${ROOM.maps.by.decider}`);
  });

  it("keeps a flat decider on Picked", async () => {
    // Same `picked`/`decider` pair, no slots: this map really is the series'
    // decider, so "Remaining" would be wrong and flat copy is unchanged.
    getMapPoolState.mockResolvedValue(
      state({
        sequence: ["ban_home", "decider"],
        pool: [
          entry({ id: 1, map_id: 22, status: "banned", action_index: 0 }),
          entry({ id: 2, map_id: 23, status: "picked", picked_by: "decider", action_index: 1 })
        ],
        is_complete: true
      })
    );
    await render();

    const decider = tiles().get("Map 23");
    expect(decider).toBeDefined();
    expect(decider!.textContent).toContain(ROOM.maps.status.picked);
    expect(decider!.textContent).not.toContain(ROOM.maps.status.remaining);
    // ...and the order list still names it, since in flat mode the decider is
    // the one map no side chose. Nothing else pins this copy, so dropping the
    // `entry.slot == null` conjunct above would strip it from every flat veto.
    expect(container.textContent).toContain(`1. Map 23 · ${ROOM.maps.by.decider}`);
  });

  it("opens the live slot's candidate and leaves an upcoming slot's inert", async () => {
    getMapPoolState.mockResolvedValue(liveState());
    await render();

    const live = tiles().get("Map 33");
    const future = tiles().get("Map 41");
    expect(live).toBeDefined();
    expect(future).toBeDefined();
    // Both are `available`; only the live one may be selected. This pair is the
    // whole point — asserting on the future tile alone would also pass for a
    // grid that disabled everything.
    expect(live!.disabled).toBe(false);
    expect(future!.disabled).toBe(true);
    expect(future!.className).toContain("border-dashed");
    const lockedText = ROOM.slot.locked.replace("{n}", "9");
    expect(future!.getAttribute("title")).toBe(lockedText);
    // `title` is the one affordance an inert tile cannot lean on — a disabled
    // button's tooltip is not reliably announced — so the reason must also be
    // real text in the group AND reachable from the control that it explains.
    expect(container.querySelector('[data-veto-map-slot="9"]')?.textContent).toContain(lockedText);
    const describedBy = future!.getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    expect(container.querySelector(`#${describedBy}`)?.textContent?.trim()).toBe(lockedText);
    // The live slot has nothing to explain, so it must not borrow the hint.
    expect(live!.getAttribute("aria-describedby")).toBeNull();
  });

  it("does not select an upcoming slot's map when it is clicked", async () => {
    getMapPoolState.mockResolvedValue(liveState());
    await render();

    const pressed = (name: string) => tiles().get(name)!.getAttribute("aria-pressed");
    const confirmFor = (name: string) => ROOM.captain.confirmBan.replace("{map}", name);

    // Two separate acts, and the node is re-queried after each: `onSelect`
    // TOGGLES, so two clicks inside one act would cancel out and the assertion
    // would hold even for a tile that did respond. `HTMLElement.click()` is the
    // UA path a captain's tap takes and a disabled control must not dispatch
    // from it; the raw bubbling event covers a handler wired past that guard.
    await act(async () => {
      tiles().get("Map 41")!.click();
    });
    expect(pressed("Map 41")).toBe("false");
    expect(container.textContent).not.toContain(confirmFor("Map 41"));

    await act(async () => {
      tiles().get("Map 41")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(pressed("Map 41")).toBe("false");
    expect(container.textContent).not.toContain(confirmFor("Map 41"));

    // The live slot's candidate DOES select, so the assertions above are about
    // the slot gate and not about a grid that stopped responding altogether.
    await act(async () => {
      tiles().get("Map 33")!.click();
    });
    expect(pressed("Map 33")).toBe("true");
    expect(container.textContent).toContain(confirmFor("Map 33"));
  });

  it("still groups by slot after the veto completes, when current_slot is null", async () => {
    // A finished slot veto reports `current_slot: null` exactly like a flat one.
    // Mode has to come from `pool[].slot`, so the groups must survive.
    getMapPoolState.mockResolvedValue(
      liveState({
        current_slot: null,
        current_step_index: null,
        expected_action: null,
        turn_side: null,
        viewer_can_act: false,
        allowed_actions: [],
        is_complete: true,
        pool: slotPool().map((e) => (e.status === "available" ? { ...e, status: "banned" } : e))
      })
    );
    await render();

    for (const n of [2, 5, 9]) {
      expect(container.textContent).toContain(ROOM.slot.label.replace("{n}", String(n)));
    }
    expect(container.textContent).toContain(ROOM.slot.resolved);
    expect(container.textContent).not.toContain(ROOM.slot.current);
  });

  it("leaves a flat pool ungrouped", async () => {
    getMapPoolState.mockResolvedValue(
      state({
        sequence: ["ban_home", "ban_away", "decider"],
        pool: [entry({ id: 1, map_id: 21 }), entry({ id: 2, map_id: 22 }), entry({ id: 3, map_id: 23 })],
        current_step_index: 0
      })
    );
    await render();

    expect(container.textContent).not.toContain(ROOM.slot.label.replace("{n}", "1"));
    expect(container.textContent).not.toContain(ROOM.slot.current);
  });

  it("scrolls the live slot into view", async () => {
    getMapPoolState.mockResolvedValue(liveState());
    await render();
    expect(scrollIntoView).toHaveBeenCalled();
  });

  it("does not scroll when no slot is live", async () => {
    // Separate test, not a second `render()` on the same root: a re-render that
    // never remounts would leave the effect unrun and pass for the wrong reason.
    getMapPoolState.mockResolvedValue(
      state({ sequence: SLOT_SEQUENCE, pool: slotPool(), current_slot: null, is_complete: true }),
    );
    await render();
    expect(scrollIntoView).not.toHaveBeenCalled();
  });

  /**
   * Slots 5 and 9 name a reserve and slot 2 does not, so the snapshot is sparse
   * — it omits a slot with no reserve rather than mapping it to null — and the
   * keys are the gapped positions AS STRINGS, which is how the JSON column
   * round-trips them. Two of three slots carry a label, so neither "every slot"
   * nor "only the live slot" passes.
   */
  const reserved = (slot_reserves: Record<string, number> | null) =>
    liveState({ session: session({ slot_reserves }) });
  const groupText = (slot: number) =>
    container.querySelector(`[data-veto-map-slot="${slot}"]`)?.textContent ?? "";
  /** The copy with nothing substituted — what an empty label would still emit. */
  const RESERVE_PREFIX = ROOM.slot.reserve.split("{map}")[0];

  it("labels each slot's reserve from the session snapshot", async () => {
    getMapPoolState.mockResolvedValue(reserved({ "5": 84, "9": 26 }));
    await render();

    expect(groupText(5)).toContain(ROOM.slot.reserve.replace("{map}", "Map 84"));
    expect(groupText(9)).toContain(ROOM.slot.reserve.replace("{map}", "Map 26"));
    // Scoped per group, because one shared caption listing both reserves — or a
    // label rendered under the wrong slot — passes a whole-document assertion.
    expect(groupText(5)).not.toContain("Map 26");
    expect(groupText(9)).not.toContain("Map 84");
  });

  it("renders no reserve line at all for a slot the snapshot omits", async () => {
    getMapPoolState.mockResolvedValue(reserved({ "5": 84, "9": 26 }));
    await render();

    // Slot 2 is absent from the snapshot. The failure this pins is the caption
    // rendering with nothing after the colon, which `toContain` on a full label
    // would miss — hence the prefix.
    expect(groupText(2)).not.toContain(RESERVE_PREFIX);
  });

  it.each([
    // A slot config that named no reserve snapshots `{}`; a flat pool snapshots
    // null. Different facts on the wire, same absence of a label.
    ["a slot session that named none", {} as Record<string, number>],
    ["a flat session", null]
  ])("shows no reserve anywhere for %s", async (_label, snapshot) => {
    getMapPoolState.mockResolvedValue(reserved(snapshot));
    await render();

    expect(container.textContent).not.toContain(RESERVE_PREFIX);
  });

  it("keeps the reserve on a resolved slot, which the regulation can still reach", async () => {
    // Slot 2 has already produced its survivor. The map may yet draw, so the
    // regulation's fallback still applies and dimming the slot must not drop it.
    getMapPoolState.mockResolvedValue(reserved({ "2": 84 }));
    await render();

    expect(groupText(2)).toContain(ROOM.slot.reserve.replace("{map}", "Map 84"));
    expect(groupText(5)).not.toContain(RESERVE_PREFIX);
    expect(groupText(9)).not.toContain(RESERVE_PREFIX);
  });
});

describe("slot-mode timeline", () => {
  const liveSlotState = () =>
    state({
      sequence: SLOT_SEQUENCE,
      pool: slotPool(),
      current_slot: 5,
      current_step_index: 4
    });

  /** Timeline slot groups keyed by the slot they resolve. */
  const timelineGroups = () => {
    const bySlot = new Map<number, HTMLElement>();
    // The grid carries `data-veto-map-slot`, so this hook reaches the timeline's
    // groups alone — no filtering on a spacing class a visual tweak can change.
    for (const node of container.querySelectorAll("[data-veto-step-slot]")) {
      bySlot.set(Number(node.getAttribute("data-veto-step-slot")), node as HTMLElement);
    }
    return bySlot;
  };

  it("attributes each decider to the slot it closes", async () => {
    getMapPoolState.mockResolvedValue(liveSlotState());
    await render();

    const groups = timelineGroups();
    expect([...groups.keys()].sort((a, b) => a - b)).toEqual([2, 5, 9]);
    // One decider closes each slot, and it now sits inside that slot's group.
    // Counting the three globally would also pass for a flat timeline, which is
    // precisely the shape this replaces.
    for (const [slot, node] of groups) {
      const deciders = [...node.querySelectorAll("span")].filter(
        (span) => span.textContent?.trim() === ROOM.steps.decider
      );
      expect(deciders, `slot ${slot}`).toHaveLength(1);
      expect(node.textContent).toContain(ROOM.slot.label.replace("{n}", String(slot)));
    }
    // Step numbers stay global — slot 9's decider is step 9, not step 4.
    expect(groups.get(9)!.textContent).toContain("9");
  });

  it("folds every slot but the live one away below lg", async () => {
    getMapPoolState.mockResolvedValue(liveSlotState());
    await render();

    const groups = timelineGroups();
    const folded = [...groups.entries()].filter(([, node]) =>
      node.className.includes("hidden lg:flex")
    );
    expect(folded.map(([slot]) => slot).sort((a, b) => a - b)).toEqual([2, 9]);
    expect(groups.get(5)!.className).not.toContain("hidden");
  });

  it("keeps the whole run visible, and grouped, once nothing is live", async () => {
    getMapPoolState.mockResolvedValue(
      state({
        sequence: SLOT_SEQUENCE,
        pool: slotPool().map((e) => (e.status === "available" ? { ...e, status: "banned" } : e)),
        current_slot: null,
        current_step_index: null,
        is_complete: true
      })
    );
    await render();

    const groups = timelineGroups();
    // Still grouped: `current_slot` is null here exactly as in flat mode, so a
    // timeline reading mode off it would drop the headings and show nine steps
    // with three interchangeable "Decider" rows.
    expect([...groups.keys()].sort((a, b) => a - b)).toEqual([2, 5, 9]);
    // Nothing to fold to, so nothing folds.
    for (const [slot, node] of groups) {
      expect(node.className, `slot ${slot}`).not.toContain("hidden");
    }
  });

  it("leaves a flat timeline ungrouped", async () => {
    getMapPoolState.mockResolvedValue(
      state({
        sequence: ["ban_home", "ban_away", "decider"],
        pool: [entry({ id: 1, map_id: 21 }), entry({ id: 2, map_id: 22 }), entry({ id: 3, map_id: 23 })],
        current_step_index: 0
      })
    );
    await render();

    expect(timelineGroups().size).toBe(0);
    expect(container.textContent).toContain(ROOM.steps.decider);
  });
});
