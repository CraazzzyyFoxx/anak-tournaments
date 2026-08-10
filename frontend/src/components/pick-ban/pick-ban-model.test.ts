import { describe, expect, it } from "vitest";

import en from "@/i18n/messages/en.json";
import ru from "@/i18n/messages/ru.json";
import type { PickBanEntry, PickBanSession, PickBanState, VetoUnavailableReason } from "@/types/tournament.types";

import {
  PICK_BAN_UNAVAILABLE_COPY,
  isEntrySelectable,
  isSessionActive,
  parseStepToken,
  pickBanReserveMap,
  pickedItemsInOrder,
  poolRoundGroups,
  roundState,
  statusLabelKey,
  stepRoundGroups,
  turnDeadlineMs,
} from "./pick-ban-model";

function entry(overrides: Partial<PickBanEntry>): PickBanEntry {
  return {
    id: 1,
    item_id: 1,
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

function session(overrides: Partial<PickBanSession>): PickBanSession {
  return {
    id: 1,
    kind: "hero",
    status: "active",
    first_side: "home",
    awaiting_choice: false,
    pending_loser_side: null,
    seed_source: "bracket_slot",
    home_seed: 1,
    away_seed: 2,
    turn_timer_seconds: 60,
    slot_reserves: null,
    started_at: "2026-07-18T10:00:00Z",
    current_step_started_at: "2026-07-18T10:00:00Z",
    ...overrides,
  };
}

function state(overrides: Partial<PickBanState>): PickBanState {
  return {
    session: session({}),
    readiness: { home: true, away: true },
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
    ...overrides,
  };
}

describe("parseStepToken", () => {
  it("splits side-resolved tokens into action + side", () => {
    expect(parseStepToken("ban_home")).toEqual({ token: "ban_home", action: "ban", side: "home" });
    expect(parseStepToken("pick_away")).toEqual({ token: "pick_away", action: "pick", side: "away" });
    expect(parseStepToken("protect_home")).toEqual({ token: "protect_home", action: "protect", side: "home" });
    expect(parseStepToken("protect_away")).toEqual({ token: "protect_away", action: "protect", side: "away" });
  });

  it("treats decider as its own action with no side", () => {
    expect(parseStepToken("decider")).toEqual({ token: "decider", action: "decider", side: null });
  });
});

describe("pickedItemsInOrder", () => {
  it("keeps picked and played items sorted by global action order", () => {
    const pool = [
      entry({ id: 1, item_id: 11, status: "banned", action_index: 0 }),
      entry({ id: 2, item_id: 12, status: "picked", action_index: 2 }),
      entry({ id: 3, item_id: 13, status: "played", action_index: 1 }),
      entry({ id: 4, item_id: 14, status: "available" }),
    ];
    expect(pickedItemsInOrder(pool).map((e) => e.item_id)).toEqual([13, 12]);
  });

  it("falls back to `order` when action_index is unset", () => {
    const pool = [
      entry({ id: 1, item_id: 11, status: "picked", order: 2 }),
      entry({ id: 2, item_id: 12, status: "picked", order: 1 }),
    ];
    expect(pickedItemsInOrder(pool).map((e) => e.item_id)).toEqual([12, 11]);
  });
});

describe("turnDeadlineMs", () => {
  it("computes started_at + timer for an active session", () => {
    const deadline = turnDeadlineMs(state({}));
    expect(deadline).toBe(Date.parse("2026-07-18T10:00:00Z") + 60_000);
  });

  it("hides the indicator when no timer is configured", () => {
    expect(turnDeadlineMs(state({ session: session({ turn_timer_seconds: null }) }))).toBeNull();
    expect(turnDeadlineMs(state({ session: session({ current_step_started_at: null }) }))).toBeNull();
  });

  it("hides the indicator for inactive or finished sessions", () => {
    expect(turnDeadlineMs(state({ session: session({ status: "completed" }) }))).toBeNull();
    expect(turnDeadlineMs(state({ is_complete: true }))).toBeNull();
    expect(turnDeadlineMs(state({ session: null }))).toBeNull();
  });
});

describe("isSessionActive", () => {
  it("is true only for a non-null active session", () => {
    expect(isSessionActive(session({ status: "active" }))).toBe(true);
    expect(isSessionActive(session({ status: "completed" }))).toBe(false);
    expect(isSessionActive(session({ status: "cancelled" }))).toBe(false);
    expect(isSessionActive(null)).toBe(false);
  });
});

/**
 * Resolve a dotted key under `pickBan.room`, the namespace every copy key in
 * `PICK_BAN_UNAVAILABLE_COPY` and the round timeline/grid copy is relative to.
 */
function roomMessage(catalogue: typeof en | typeof ru, key: string): unknown {
  return key
    .split(".")
    .reduce<unknown>(
      (node, segment) => (node != null && typeof node === "object" ? (node as Record<string, unknown>)[segment] : undefined),
      catalogue.pickBan.room,
    );
}

describe("PICK_BAN_UNAVAILABLE_COPY", () => {
  const REASONS: readonly VetoUnavailableReason[] = [
    "not_configured",
    "teams_unknown",
    "slot_count_mismatch",
    "slot_underfilled",
    "not_ready",
    "waiting_map",
  ];

  it("covers exactly the reasons the union carries", () => {
    expect(new Set(Object.keys(PICK_BAN_UNAVAILABLE_COPY))).toEqual(new Set(REASONS));
  });

  it("gives every mapped reason its own non-empty copy in both locales", () => {
    const entries = Object.entries(PICK_BAN_UNAVAILABLE_COPY);
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
    expect(seen.titleKey.size).toBe(entries.length);
    expect(seen.hintKey.size).toBe(entries.length);
    expect(seen.en.size).toBe(entries.length * 2);
    expect(seen.ru.size).toBe(entries.length * 2);
  });
});

/**
 * A three-round Bo5 whose numbers all disagree with one another, so no helper
 * can pass by confusing round/order/id.
 *
 * Round 1 has resolved (one survivor, two bans), round 2 is mid-ban, round 3
 * has not opened yet.
 */
function roundPool(): PickBanEntry[] {
  return [
    entry({ id: 71, item_id: 41, round: 3, order: 6, status: "available" }),
    entry({ id: 62, item_id: 33, round: 2, order: 4, status: "available" }),
    entry({ id: 53, item_id: 21, round: 1, order: 1, status: "picked", picked_by: "decider", action_index: 2 }),
    entry({ id: 74, item_id: 42, round: 3, order: 7, status: "available" }),
    entry({ id: 51, item_id: 22, round: 1, order: 2, status: "banned", action_index: 0 }),
    entry({ id: 75, item_id: 43, round: 3, order: 8, status: "available" }),
    entry({ id: 61, item_id: 32, round: 2, order: 3, status: "banned", action_index: 3 }),
    entry({ id: 52, item_id: 23, round: 1, order: 5, status: "banned", action_index: 1 }),
    entry({ id: 76, item_id: 44, round: 3, order: 9, status: "available" }),
  ];
}

const ROUND_SEQUENCE = [
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

describe("poolRoundGroups", () => {
  it("groups by round in ascending play order", () => {
    expect(poolRoundGroups(roundPool())?.map((group) => group.round)).toEqual([1, 2, 3]);
  });

  it("returns null for a flat (round-less) pool", () => {
    expect(poolRoundGroups([entry({ round: null })])).toBeNull();
  });
});

describe("stepRoundGroups", () => {
  it("gives each round as many consecutive steps as it has candidates", () => {
    expect(
      stepRoundGroups(ROUND_SEQUENCE, roundPool())?.map(({ round, stepIndices }) => ({ round, stepIndices })),
    ).toEqual([
      { round: 1, stepIndices: [0, 1, 2] },
      { round: 2, stepIndices: [3, 4] },
      { round: 3, stepIndices: [5, 6, 7, 8] },
    ]);
  });

  it("returns null for a flat pool", () => {
    expect(stepRoundGroups(ROUND_SEQUENCE, [entry({ round: null })])).toBeNull();
  });
});

describe("roundState", () => {
  const groups = poolRoundGroups(roundPool()) ?? [];

  it("separates resolved, current and not-yet-open rounds", () => {
    expect(roundState(groups[0], 2)).toBe("resolved");
    expect(roundState(groups[1], 2)).toBe("current");
    expect(roundState(groups[2], 2)).toBe("upcoming");
  });

  it("calls every round resolved once the sequence is complete", () => {
    // A completed round-mode session reports `current_round: null`, exactly
    // like a flat one, so nothing may be inferred from the null itself.
    const finished = poolRoundGroups(
      roundPool().map((e) => (e.status === "available" ? { ...e, status: "banned" as const } : e)),
    );
    expect(finished?.map((group) => roundState(group, null))).toEqual(["resolved", "resolved", "resolved"]);
  });
});

describe("isEntrySelectable", () => {
  const byRound = (round: number, status: PickBanEntry["status"] = "available") =>
    roundPool().find((e) => e.round === round && e.status === status)!;

  it("requires canSelect and an available entry", () => {
    expect(isEntrySelectable(byRound(2), { canSelect: false, currentRound: 2 })).toBe(false);
    expect(isEntrySelectable(byRound(1, "banned"), { canSelect: true, currentRound: 1 })).toBe(false);
  });

  it("only the live round's available entries are selectable in round mode", () => {
    expect(isEntrySelectable(byRound(2), { canSelect: true, currentRound: 2 })).toBe(true);
    expect(isEntrySelectable(byRound(3), { canSelect: true, currentRound: 2 })).toBe(false);
  });

  it("a round-less entry has no round to be outside of", () => {
    expect(isEntrySelectable(entry({ round: null }), { canSelect: true, currentRound: null })).toBe(true);
  });
});

describe("statusLabelKey", () => {
  it("calls a round survivor remaining, not picked", () => {
    const survivor = entry({ round: 1, status: "picked", picked_by: "decider" });
    expect(statusLabelKey(survivor)).toBe("status.remaining");
  });

  it("keeps a flat-mode trailing decider as picked", () => {
    const decider = entry({ round: null, status: "picked", picked_by: "decider" });
    expect(statusLabelKey(decider)).toBe("status.picked");
  });

  it("otherwise labels by the entry's own status", () => {
    expect(statusLabelKey(entry({ status: "available" }))).toBe("status.available");
    expect(statusLabelKey(entry({ status: "banned" }))).toBe("status.banned");
    expect(statusLabelKey(entry({ status: "protected" }))).toBe("status.protected");
    expect(statusLabelKey(entry({ status: "played" }))).toBe("status.played");
  });
});

describe("pickBanReserveMap", () => {
  it("is empty for no session, a null snapshot, and an empty snapshot", () => {
    expect(pickBanReserveMap(null).size).toBe(0);
    expect(pickBanReserveMap(session({ slot_reserves: null })).size).toBe(0);
    expect(pickBanReserveMap(session({ slot_reserves: {} })).size).toBe(0);
  });

  it("converts string-keyed positions to a number-keyed Map", () => {
    const map = pickBanReserveMap(session({ slot_reserves: { "1": 41, "3": 43 } }));
    expect(map.get(1)).toBe(41);
    expect(map.get(3)).toBe(43);
    expect(map.get(2)).toBeUndefined();
  });
});
