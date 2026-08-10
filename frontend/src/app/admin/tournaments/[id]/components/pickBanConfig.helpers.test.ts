// The three wire fields an organizer must never be handed raw, pinned here.
//
// `preset` is the important one: the engine only reads `sequence` when
// `preset === "custom"` (`pick_ban_session.ensure_pick_ban_session`), so a form
// that lets the two drift silently discards a hand-authored order. The rest of
// the file covers the scope key the server validates and the rejections the
// editor has to surface before save rather than after a 422.
import { describe, expect, it } from "vitest";

import type { PickBanConfig, Stage } from "@/types/tournament.types";

import {
  effectiveSequence,
  emptyPickBanDraft,
  findScopeCollision,
  pickBanDraftFromConfig,
  pickBanDraftToInput,
  protectHasNoStep,
  resolveSeriesLength,
  roundsPlayed,
  stageRoundOptions,
  validatePickBanDraft,
  type PickBanDraft,
} from "./pickBanConfig.helpers";

function draft(overrides: Partial<PickBanDraft> = {}): PickBanDraft {
  return { ...emptyPickBanDraft("map"), itemIds: [1, 2, 3, 4, 5], ...overrides };
}

function stage(overrides: Partial<Stage> = {}): Stage {
  return {
    id: 10,
    tournament_id: 84,
    name: "Playoffs",
    description: null,
    stage_type: "single_elimination",
    max_rounds: 3,
    advance_count: null,
    split_lower_bracket: false,
    order: 1,
    is_active: true,
    is_completed: false,
    settings_json: null,
    challonge_id: null,
    challonge_slug: null,
    items: [],
    ...overrides,
  } as Stage;
}

function config(overrides: Partial<PickBanConfig> = {}): PickBanConfig {
  return {
    id: 1,
    tournament_id: 84,
    kind: "map",
    stage_id: null,
    round: null,
    mode: "pool",
    first_pick_rule: "higher_seed",
    first_ban_rotation: "fixed",
    turn_timer_seconds: null,
    preset: "bracket",
    sequence: ["ban_first", "ban_second", "pick_first", "pick_second", "decider"],
    no_repeat_scope: "none",
    unique_attribute_per_side_per_round: null,
    allow_protect: false,
    item_ids: [1, 2, 3, 4, 5],
    slots: [],
    ...overrides,
  };
}

describe("step order is only stored when it will be read", () => {
  it("marks a hand-authored order custom, so the engine stops regenerating it", () => {
    const input = pickBanDraftToInput(
      draft({ orderMode: "custom", sequence: ["ban_first", "pick_second", "decider"] }),
      3
    );

    expect(input.preset).toBe("custom");
    expect(input.sequence).toEqual(["ban_first", "pick_second", "decider"]);
  });

  it("ships a generated order under bracket mode, never an empty sequence", () => {
    // `validate_pick_ban_config` rejects an empty sequence whatever the preset,
    // so bracket mode has to store a placeholder rather than nothing.
    const input = pickBanDraftToInput(draft({ orderMode: "bracket" }), 3);

    expect(input.preset).not.toBe("custom");
    expect(input.sequence).toEqual(["ban_first", "ban_second", "pick_first", "pick_second", "decider"]);
  });

  it("ignores a stale custom sequence once bracket order is chosen", () => {
    const stale: PickBanDraft = draft({
      orderMode: "bracket",
      sequence: ["pick_first", "pick_first", "pick_first"],
    });

    expect(effectiveSequence(stale, 3)).toEqual([
      "ban_first",
      "ban_second",
      "pick_first",
      "pick_second",
      "decider",
    ]);
  });

  it("never sends the custom preset in slot mode, which the database forbids", () => {
    // `ck_pick_ban_config_slots_not_custom`.
    const input = pickBanDraftToInput(
      draft({
        mode: "slots",
        orderMode: "custom",
        sequence: ["pick_first"],
        slots: [{ candidates: [1, 2], reserveItemId: null }],
      }),
      1
    );

    expect(input.preset).not.toBe("custom");
    expect(input.sequence).toEqual([]);
    expect(input.item_ids).toEqual([]);
    expect(input.slots).toEqual([{ candidates: [1, 2], reserve_item_id: null }]);
  });

  it("round-trips a stored custom config back into custom order", () => {
    const restored = pickBanDraftFromConfig(
      config({ preset: "custom", sequence: ["ban_first", "decider"] })
    );

    expect(restored.orderMode).toBe("custom");
    expect(pickBanDraftToInput(restored, 3).sequence).toEqual(["ban_first", "decider"]);
  });

  it("counts the rounds a sequence plays, ignoring bans", () => {
    expect(roundsPlayed(["ban_first", "ban_second", "pick_first", "pick_second", "decider"])).toBe(3);
  });
});

describe("options the engine only implements in one shape", () => {
  it("drops the role restriction on a map config, where it has no meaning", () => {
    const asMap = pickBanDraftToInput(draft({ kind: "map", uniqueRolePerRound: true }), 3);
    const asHero = pickBanDraftToInput(draft({ kind: "hero", uniqueRolePerRound: true }), 3);

    expect(asMap.unique_attribute_per_side_per_round).toBeNull();
    expect(asHero.unique_attribute_per_side_per_round).toBe("role");
  });

  it("drops a round that no stage scopes it, which the server rejects", () => {
    // `admin_pick_ban_config_upsert`: "round requires stage_id".
    expect(pickBanDraftToInput(draft({ stageId: null, round: 4 }), 3).round).toBeNull();
    expect(pickBanDraftToInput(draft({ stageId: 10, round: 4 }), 3).round).toBe(4);
  });

  it("reports a protect toggle that no step will ever run", () => {
    expect(protectHasNoStep(draft({ allowProtect: true, orderMode: "bracket" }), 3)).toBe(true);
    expect(
      protectHasNoStep(
        draft({ allowProtect: true, orderMode: "custom", sequence: ["protect_first", "decider"] }),
        3
      )
    ).toBe(false);
    expect(protectHasNoStep(draft({ allowProtect: false }), 3)).toBe(false);
  });
});

describe("validation mirrors what the server would reject", () => {
  it("accepts a pool config the server accepts", () => {
    expect(validatePickBanDraft(draft(), 3)).toEqual([]);
  });

  it("reports an empty pool", () => {
    expect(validatePickBanDraft(draft({ itemIds: [] }), 3)).toEqual([{ key: "emptyPool" }]);
  });

  it("reports a custom order with no steps", () => {
    expect(validatePickBanDraft(draft({ orderMode: "custom", sequence: [] }), 3)).toEqual([
      { key: "emptySequence" },
    ]);
  });

  it("reports a decider that is not the last step, and duplicated deciders", () => {
    expect(
      validatePickBanDraft(draft({ orderMode: "custom", sequence: ["decider", "pick_first"] }), 3)
    ).toEqual([{ key: "deciderNotLast" }]);
    expect(
      validatePickBanDraft(draft({ orderMode: "custom", sequence: ["decider", "decider"] }), 3)
    ).toEqual([{ key: "multipleDeciders" }]);
  });

  it("reports an order of bans alone, which resolves nothing", () => {
    expect(
      validatePickBanDraft(draft({ orderMode: "custom", sequence: ["ban_first", "ban_second"] }), 3)
    ).toEqual([{ key: "noPickOrDecider" }]);
  });

  it("reports an order longer than the pool it draws from", () => {
    expect(
      validatePickBanDraft(
        draft({
          itemIds: [1, 2],
          orderMode: "custom",
          sequence: ["ban_first", "pick_first", "pick_second"],
        }),
        3
      )
    ).toEqual([{ key: "sequenceLongerThanPool", values: { steps: 3, items: 2 } }]);
  });

  it("reports slot mode with no groups, and a group with nothing to ban", () => {
    expect(validatePickBanDraft(draft({ mode: "slots", slots: [] }), 3)).toEqual([
      { key: "emptySlots" },
    ]);
    expect(
      validatePickBanDraft(
        draft({
          mode: "slots",
          slots: [
            { candidates: [1, 2], reserveItemId: null },
            { candidates: [3], reserveItemId: null },
          ],
        }),
        2
      )
    ).toEqual([{ key: "slotTooFewCandidates", values: { slot: 2 } }]);
  });
});

describe("scope resolution", () => {
  const stages = [stage({ id: 10, max_rounds: 3, settings_json: { best_of: { default: 5 } } })];

  it("takes a stage's rounds from the generated encounters when they exist", () => {
    const rounds = stageRoundOptions(10, stages, [
      { stage_id: 10, round: 2, best_of: 3 },
      { stage_id: 10, round: 1, best_of: 3 },
      { stage_id: 11, round: 9, best_of: 3 },
      { stage_id: 10, round: 2, best_of: 3 },
    ]);

    expect(rounds).toEqual([1, 2]);
  });

  it("falls back to the planned rounds before a bracket is generated", () => {
    expect(stageRoundOptions(10, stages, undefined)).toEqual([1, 2, 3]);
    expect(stageRoundOptions(10, stages, [])).toEqual([1, 2, 3]);
  });

  it("prefers a generated encounter's series length over the stage default", () => {
    expect(resolveSeriesLength(10, 1, stages, [{ stage_id: 10, round: 1, best_of: 7 }])).toEqual({
      bestOf: 7,
      source: "round",
    });
  });

  it("labels a stage-wide or tournament-wide scope as a preview, not a promise", () => {
    expect(resolveSeriesLength(10, null, stages, undefined)).toEqual({
      bestOf: 5,
      source: "stage",
    });
    expect(resolveSeriesLength(null, null, stages, undefined).source).toBe("variesByMatch");
    expect(
      resolveSeriesLength(
        10,
        null,
        [stage({ id: 10, settings_json: { best_of: { default: 3, by_round: { "3": 5 } } } })],
        undefined
      ).source
    ).toBe("variesByRound");
  });
});

describe("scope collisions", () => {
  const saved = [
    config({ id: 1, kind: "map", stage_id: null, round: null }),
    config({ id: 2, kind: "map", stage_id: 10, round: null }),
    config({ id: 3, kind: "hero", stage_id: null, round: null }),
  ];

  it("finds the config an upsert would silently replace", () => {
    expect(findScopeCollision(draft({ kind: "map", stageId: 10 }), saved)?.id).toBe(2);
    expect(findScopeCollision(draft({ kind: "hero" }), saved)?.id).toBe(3);
  });

  it("does not call a config a collision with itself, nor across kinds", () => {
    expect(findScopeCollision(draft({ configId: 2, kind: "map", stageId: 10 }), saved)).toBeNull();
    expect(findScopeCollision(draft({ kind: "map", stageId: 10, round: 1 }), saved)).toBeNull();
  });
});
