import { describe, expect, it } from "vitest";

import en from "@/i18n/messages/en.json";
import ru from "@/i18n/messages/ru.json";
import type {
  EncounterMapPoolEntry,
  EncounterMapPoolState,
  EncounterVetoSession,
  VetoUnavailableReason,
} from "@/types/tournament.types";

import {
  VETO_UNAVAILABLE_COPY,
  isEntrySelectable,
  parseStepToken,
  pickedMapsInOrder,
  poolSlotGroups,
  slotReserveMaps,
  slotState,
  statusLabelKey,
  stepSlotGroups,
  turnDeadlineMs,
} from "./veto-model";

function entry(overrides: Partial<EncounterMapPoolEntry>): EncounterMapPoolEntry {
  return {
    id: 1,
    map_id: 1,
    // Flat pool: these cases describe a `"pool"`-mode veto, where every entry's
    // slot is null. The slot-mode suites below pass `slot` explicitly.
    slot: null,
    order: 0,
    action_index: null,
    picked_by: null,
    team_id: null,
    status: "available",
    ...overrides,
  };
}

function session(overrides: Partial<EncounterVetoSession>): EncounterVetoSession {
  return {
    id: 1,
    status: "active",
    first_side: "home",
    seed_source: "bracket_slot",
    home_seed: 1,
    away_seed: 2,
    turn_timer_seconds: 60,
    started_at: "2026-07-18T10:00:00Z",
    current_step_started_at: "2026-07-18T10:00:00Z",
    ...overrides,
  };
}

function state(overrides: Partial<EncounterMapPoolState>): EncounterMapPoolState {
  return {
    session: session({}),
    sequence: [],
    pool: [],
    viewer_side: null,
    viewer_can_act: false,
    allowed_actions: [],
    current_step_index: 0,
    current_step: null,
    expected_action: null,
    turn_side: null,
    current_slot: null,
    is_complete: false,
    ...overrides,
  };
}

describe("parseStepToken", () => {
  it("splits side-resolved tokens into action + side", () => {
    expect(parseStepToken("ban_home")).toEqual({ token: "ban_home", action: "ban", side: "home" });
    expect(parseStepToken("pick_away")).toEqual({
      token: "pick_away",
      action: "pick",
      side: "away",
    });
  });

  it("treats decider as sideless", () => {
    expect(parseStepToken("decider")).toEqual({ token: "decider", action: "decider", side: null });
  });
});

describe("pickedMapsInOrder", () => {
  it("keeps picked and played maps sorted by global action order", () => {
    const pool = [
      entry({ id: 1, map_id: 11, status: "banned", action_index: 0 }),
      entry({ id: 2, map_id: 12, status: "played", action_index: 3 }),
      entry({ id: 3, map_id: 13, status: "picked", action_index: 2 }),
      entry({ id: 4, map_id: 14, status: "available" }),
    ];
    expect(pickedMapsInOrder(pool).map((e) => e.map_id)).toEqual([13, 12]);
  });

  it("falls back to legacy `order` when action_index is missing", () => {
    const pool = [
      entry({ id: 1, map_id: 11, status: "picked", order: 2 }),
      entry({ id: 2, map_id: 12, status: "picked", order: 1 }),
    ];
    expect(pickedMapsInOrder(pool).map((e) => e.map_id)).toEqual([12, 11]);
  });
});

describe("turnDeadlineMs", () => {
  it("computes started_at + timer for an active session", () => {
    const deadline = turnDeadlineMs(state({}));
    expect(deadline).toBe(Date.parse("2026-07-18T10:00:00Z") + 60_000);
  });

  it("hides the indicator when no timer is configured", () => {
    expect(turnDeadlineMs(state({ session: session({ turn_timer_seconds: null }) }))).toBeNull();
    expect(
      turnDeadlineMs(state({ session: session({ current_step_started_at: null }) })),
    ).toBeNull();
  });

  it("hides the indicator for inactive or finished sessions", () => {
    expect(turnDeadlineMs(state({ session: session({ status: "completed" }) }))).toBeNull();
    expect(turnDeadlineMs(state({ is_complete: true }))).toBeNull();
    expect(turnDeadlineMs(state({ session: null }))).toBeNull();
  });
});

/**
 * Resolve a dotted key under `encounters.veto.room`, the namespace every copy
 * key in `VETO_UNAVAILABLE_COPY` is relative to.
 */
function roomMessage(catalogue: typeof en | typeof ru, key: string): unknown {
  return key
    .split(".")
    .reduce<unknown>(
      (node, segment) =>
        node != null && typeof node === "object"
          ? (node as Record<string, unknown>)[segment]
          : undefined,
      catalogue.encounters.veto.room,
    );
}

describe("VETO_UNAVAILABLE_COPY", () => {
  // Listed literally, not read off the map: a derived list would agree with any
  // map, including one that dropped a reason behind a fallback lookup.
  const REASONS: readonly VetoUnavailableReason[] = [
    "not_configured",
    "teams_unknown",
    "slot_count_mismatch",
    "slot_underfilled",
    "not_ready",
    "waiting_map",
  ];

  it("covers exactly the reasons the union carries", () => {
    expect(new Set(Object.keys(VETO_UNAVAILABLE_COPY))).toEqual(new Set(REASONS));
  });

  it("gives every mapped reason its own non-empty copy in both locales", () => {
    // Walks the MAP's own entries rather than `REASONS`, so a newly added reason
    // is checked here the moment it appears — even before anyone remembers to
    // extend the list above.
    const entries = Object.entries(VETO_UNAVAILABLE_COPY);
    const seen: Record<"titleKey" | "hintKey" | "en" | "ru", Set<string>> = {
      titleKey: new Set(),
      hintKey: new Set(),
      en: new Set(),
      ru: new Set(),
    };
    for (const [reason, { titleKey, hintKey }] of entries) {
      seen.titleKey.add(titleKey);
      seen.hintKey.add(hintKey);
      for (const [locale, catalogue] of [
        ["en", en],
        ["ru", ru],
      ] as const) {
        for (const key of [titleKey, hintKey]) {
          const message = roomMessage(catalogue, key);
          expect(message, `${locale}: ${reason} -> ${key}`).toBeTypeOf("string");
          expect(message as string, `${locale}: ${reason} -> ${key}`).not.toBe("");
          seen[locale].add(message as string);
        }
      }
    }
    // Distinctness is the load-bearing half: a total `Record` forces an entry to
    // EXIST but happily accepts one pointed at `not_configured`'s strings, which
    // is exactly the bug this map replaces.
    expect(seen.titleKey.size).toBe(entries.length);
    expect(seen.hintKey.size).toBe(entries.length);
    expect(seen.en.size).toBe(entries.length * 2);
    expect(seen.ru.size).toBe(entries.length * 2);
  });

  it("sends a config that disagrees with the bracket to its own copy, not to not_configured", () => {
    expect(VETO_UNAVAILABLE_COPY.slot_count_mismatch).toEqual({
      titleKey: "empty.slotCountMismatchTitle",
      hintKey: "empty.slotCountMismatchHint",
      icon: "misconfigured",
    });
    expect(VETO_UNAVAILABLE_COPY.slot_underfilled).toEqual({
      titleKey: "empty.slotUnderfilledTitle",
      hintKey: "empty.slotUnderfilledHint",
      icon: "misconfigured",
    });
  });

  it("keeps the two original causes on their original copy and icons", () => {
    expect(VETO_UNAVAILABLE_COPY.not_configured).toEqual({
      titleKey: "empty.notConfiguredTitle",
      hintKey: "empty.notConfiguredHint",
      icon: "unconfigured",
    });
    expect(VETO_UNAVAILABLE_COPY.teams_unknown).toEqual({
      titleKey: "empty.teamsUnknownTitle",
      hintKey: "empty.teamsUnknownHint",
      icon: "teams",
    });
  });
});

/**
 * A three-slot Bo3 whose numbers are all deliberately different from one
 * another, so no helper can pass by confusing them:
 *
 *   - positions are 2, 5 and 9 — never a 0- or 1-based index, and gapped, which
 *     a deleted middle slot really produces;
 *   - candidate counts are 3, 2 and 4 — different per slot, different from the
 *     group count (3 groups) and different from every position;
 *   - the current slot is 5, the MIDDLE one, so "first" and "last" both fail;
 *   - `id`, `map_id` and `order` disagree on every entry;
 *   - the entries arrive slot-shuffled, so the ascending group order has to come
 *     from the sort and not from input order.
 *
 * Slot 2 has resolved (one survivor, two bans), slot 5 is mid-ban, slot 9 has
 * not opened.
 */
function slotPool(): EncounterMapPoolEntry[] {
  return [
    entry({ id: 71, map_id: 41, slot: 9, order: 6, status: "available" }),
    entry({ id: 62, map_id: 33, slot: 5, order: 4, status: "available" }),
    entry({ id: 53, map_id: 21, slot: 2, order: 1, status: "picked", picked_by: "decider", action_index: 2 }),
    entry({ id: 74, map_id: 42, slot: 9, order: 7, status: "available" }),
    entry({ id: 51, map_id: 22, slot: 2, order: 2, status: "banned", action_index: 0 }),
    entry({ id: 75, map_id: 43, slot: 9, order: 8, status: "available" }),
    entry({ id: 61, map_id: 32, slot: 5, order: 3, status: "banned", action_index: 3 }),
    entry({ id: 52, map_id: 23, slot: 2, order: 5, status: "banned", action_index: 1 }),
    entry({ id: 76, map_id: 44, slot: 9, order: 9, status: "available" }),
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
  "decider",
];

describe("poolSlotGroups", () => {
  it("groups by slot position in ascending play order", () => {
    expect(poolSlotGroups(slotPool())?.map((group) => group.slot)).toEqual([2, 5, 9]);
  });

  it("keeps every entry with its own slot", () => {
    expect(poolSlotGroups(slotPool())?.map((group) => group.entries.map((e) => e.map_id))).toEqual([
      [21, 22, 23],
      [33, 32],
      [41, 42, 43, 44],
    ]);
  });

  it("reports a flat pool as having no slots at all", () => {
    expect(poolSlotGroups([entry({ id: 1, map_id: 11 }), entry({ id: 2, map_id: 12 })])).toBeNull();
    expect(poolSlotGroups([])).toBeNull();
  });
});

describe("stepSlotGroups", () => {
  it("gives each slot as many consecutive steps as it has candidates", () => {
    expect(
      stepSlotGroups(SLOT_SEQUENCE, slotPool())?.map(({ slot, stepIndices }) => ({
        slot,
        stepIndices,
      })),
    ).toEqual([
      { slot: 2, stepIndices: [0, 1, 2] },
      { slot: 5, stepIndices: [3, 4] },
      { slot: 9, stepIndices: [5, 6, 7, 8] },
    ]);
  });

  it("carries each slot's own entries alongside its steps", () => {
    // The timeline asks `slotState` about these groups directly; pairing the two
    // lists by index would agree only for slots numbered 1..N.
    expect(
      stepSlotGroups(SLOT_SEQUENCE, slotPool())?.map((group) => group.entries.map((e) => e.slot)),
    ).toEqual([
      [2, 2, 2],
      [5, 5],
      [9, 9, 9, 9],
    ]);
  });

  it("leaves a flat sequence ungrouped", () => {
    expect(stepSlotGroups(["ban_home", "decider"], [entry({ id: 1, map_id: 11 })])).toBeNull();
  });
});

describe("slotState", () => {
  const groups = poolSlotGroups(slotPool()) ?? [];

  it("separates resolved, current and not-yet-open slots", () => {
    expect(groups.map((group) => slotState(group, 5))).toEqual([
      "resolved",
      "current",
      "upcoming",
    ]);
  });

  it("calls every slot resolved once the veto is complete", () => {
    // A completed slot veto reports `current_slot: null`, exactly like a flat
    // one, so nothing may be inferred from the null itself.
    const finished = poolSlotGroups(
      slotPool().map((e) =>
        e.status === "available" ? { ...e, status: "banned" as const } : e,
      ),
    );
    expect(finished?.map((group) => slotState(group, null))).toEqual([
      "resolved",
      "resolved",
      "resolved",
    ]);
  });
});

describe("isEntrySelectable", () => {
  const bySlot = (slot: number, status: EncounterMapPoolEntry["status"] = "available") =>
    slotPool().find((e) => e.slot === slot && e.status === status)!;

  it("opens only the slot the server reports as current", () => {
    expect(isEntrySelectable(bySlot(5), { canSelect: true, currentSlot: 5 })).toBe(true);
    // Available, and still not in play — the state flat mode never produces.
    expect(isEntrySelectable(bySlot(9), { canSelect: true, currentSlot: 5 })).toBe(false);
  });

  it("never opens a banned or already resolved candidate", () => {
    expect(isEntrySelectable(bySlot(5, "banned"), { canSelect: true, currentSlot: 5 })).toBe(false);
    expect(isEntrySelectable(bySlot(2, "picked"), { canSelect: true, currentSlot: 2 })).toBe(false);
  });

  it("ignores the slot filter for a flat entry, which has no slot to be outside of", () => {
    const flat = entry({ id: 1, map_id: 11 });
    expect(isEntrySelectable(flat, { canSelect: true, currentSlot: null })).toBe(true);
    expect(isEntrySelectable(flat, { canSelect: true, currentSlot: 5 })).toBe(true);
  });

  it("stays shut when the viewer cannot act at all", () => {
    expect(isEntrySelectable(bySlot(5), { canSelect: false, currentSlot: 5 })).toBe(false);
  });
});

describe("statusLabelKey", () => {
  it("calls a slot survivor remaining, not picked", () => {
    // The decider step commits it as `picked` / `picked_by: "decider"`, so
    // "Picked" would credit a team that picked nothing.
    expect(statusLabelKey(entry({ slot: 5, status: "picked", picked_by: "decider" }))).toBe(
      "maps.status.remaining",
    );
  });

  it("still calls a FLAT decider picked", () => {
    // The discriminating fixture: identical `picked`/`decider` pair, slot null.
    // A `picked_by: "home"` fixture here would pass even for an implementation
    // that ignored `slot` entirely, which is the bug this pins.
    expect(statusLabelKey(entry({ slot: null, status: "picked", picked_by: "decider" }))).toBe(
      "maps.status.picked",
    );
    expect(statusLabelKey(entry({ slot: null, status: "picked", picked_by: "home" }))).toBe(
      "maps.status.picked",
    );
  });

  it("needs the decider pair, not slot mode alone", () => {
    // Slotted and `picked`, but credited to a side: nothing survived here, so
    // "Remaining" would be a lie. Pins that the branch reads `picked_by` too.
    expect(statusLabelKey(entry({ slot: 5, status: "picked", picked_by: "away" }))).toBe(
      "maps.status.picked",
    );
  });

  it("leaves every other status alone in slot mode", () => {
    expect(statusLabelKey(entry({ slot: 9, status: "available" }))).toBe("maps.status.available");
    expect(statusLabelKey(entry({ slot: 2, status: "banned" }))).toBe("maps.status.banned");
    // A slot map that has been played really was played.
    expect(statusLabelKey(entry({ slot: 2, status: "played" }))).toBe("maps.status.played");
  });
});

describe("slotReserveMaps", () => {
  it("re-keys the wire's string positions to the numbers the room reads slots by", () => {
    // The column is JSON, so the snapshot arrives string-keyed while every slot
    // number in the room — `pool[].slot`, `current_slot`, a group's `slot` — is a
    // number. `Map.get` is strict, so leaving the keys as strings would leave
    // every lookup undefined and the label silently absent on every slot.
    const reserves = slotReserveMaps(session({ slot_reserves: { "2": 84, "9": 26 } }));

    expect([...reserves.keys()]).toEqual([2, 9]);
    expect(reserves.get(2)).toBe(84);
    expect(reserves.get(9)).toBe(26);
  });

  it("omits a slot the snapshot never named rather than inventing an entry", () => {
    // Positions are gapped and a slot with no reserve is absent, not null, so 5
    // is missing for both reasons at once — and 3 was never a position at all.
    const reserves = slotReserveMaps(session({ slot_reserves: { "2": 84, "9": 26 } }));

    expect(reserves.has(5)).toBe(false);
    expect(reserves.has(3)).toBe(false);
    expect(reserves.size).toBe(2);
  });

  it("is empty for a flat session and for a slot config that named no reserve", () => {
    // Null and `{}` are different facts on the wire — "no slots at all" versus
    // "slots that named nothing" — but the room draws no label for either.
    expect(slotReserveMaps(session({ slot_reserves: null })).size).toBe(0);
    expect(slotReserveMaps(session({ slot_reserves: {} })).size).toBe(0);
  });

  it("is empty when there is no session", () => {
    // The unavailable state sends `session: null`, and the grid still renders.
    expect(slotReserveMaps(null).size).toBe(0);
  });
});
