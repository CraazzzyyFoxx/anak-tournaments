import { describe, expect, it } from "vitest";

import type { VetoSequenceToken } from "@/types/tournament.types";

import {
  BO3_SEQUENCE,
  BO5_SEQUENCE,
  buildBo1Sequence,
  buildToken,
  getMapsPlayedCount,
  matchesMapName,
  normalizeMapName,
  tokenLabelKey,
  validateVetoConfigForm
} from "./mapVeto.helpers";

/** The flat branch of the mode-aware validator, spelled once. */
function pool(sequence: VetoSequenceToken[], mapIds: number[]) {
  return validateVetoConfigForm({ mode: "pool", sequence, mapIds });
}

describe("buildBo1Sequence", () => {
  it("alternates bans starting with the first team, then ends with a decider", () => {
    expect(buildBo1Sequence(5)).toEqual([
      "ban_first",
      "ban_second",
      "ban_first",
      "ban_second",
      "decider"
    ]);
  });

  it("produces exactly poolSize steps so the pool-size rule always holds", () => {
    for (const size of [2, 3, 7, 9]) {
      const sequence = buildBo1Sequence(size);
      expect(sequence).toHaveLength(size);
      expect(sequence[sequence.length - 1]).toBe("decider");
      expect(
        pool(sequence, Array.from({ length: size }, (_, i) => i + 1))
      ).toEqual([]);
    }
  });
});

describe("preset sequences", () => {
  it("Bo3 and Bo5 are valid against a matching pool", () => {
    expect(pool(BO3_SEQUENCE, [1, 2, 3, 4, 5])).toEqual([]);
    expect(pool(BO5_SEQUENCE, [1, 2, 3, 4, 5, 6, 7])).toEqual([]);
  });
});

describe("validateVetoConfigForm", () => {
  it("rejects an empty pool and empty sequence", () => {
    expect(pool([], [])).toEqual([
      { key: "emptyPool" },
      { key: "emptySequence" }
    ]);
  });

  it("rejects multiple deciders", () => {
    expect(pool(["decider", "decider"], [1, 2])).toContainEqual({
      key: "multipleDeciders"
    });
  });

  it("rejects a decider that is not the last step", () => {
    expect(pool(["decider", "ban_first"], [1, 2, 3])).toContainEqual({
      key: "deciderNotLast"
    });
  });

  it("reports the step and map counts when the sequence outgrows the pool", () => {
    expect(pool(BO3_SEQUENCE, [1, 2, 3])).toContainEqual({
      key: "sequenceLongerThanPool",
      values: { steps: 5, maps: 3 }
    });
  });

  it("rejects ban-only sequences", () => {
    expect(pool(["ban_first", "ban_second"], [1, 2, 3])).toContainEqual({
      key: "noPickOrDecider"
    });
  });

  it("accepts a pick-based sequence without a decider", () => {
    expect(pool(["pick_first", "pick_second"], [1, 2, 3])).toEqual([]);
  });

  it("returns keys, never prose, so both locales render the same issue", () => {
    for (const issue of pool(["decider", "ban_first"], [])) {
      expect(typeof issue.key).toBe("string");
      expect(issue.key).toMatch(/^[a-z][A-Za-z]+$/);
    }
  });
});

describe("validateVetoConfigForm slot branch", () => {
  it("names every underfilled slot by its 1-based play position", () => {
    // Deliberately unequal: the middle slot is the valid one, so an
    // implementation reporting indices, or reporting the first failure only,
    // cannot produce this list.
    expect(
      validateVetoConfigForm({
        mode: "slots",
        slots: [{ candidates: [4] }, { candidates: [7, 1, 9] }, { candidates: [] }]
      })
    ).toEqual([
      { key: "slotTooFewCandidates", values: { slot: 1 } },
      { key: "slotTooFewCandidates", values: { slot: 3 } }
    ]);
  });

  it("accepts slots of differing sizes once each holds two candidates", () => {
    expect(
      validateVetoConfigForm({
        mode: "slots",
        slots: [{ candidates: [4, 5] }, { candidates: [7, 1, 9] }]
      })
    ).toEqual([]);
  });

  it("never applies the flat rules to a slot draft", () => {
    // A valid slot draft carries no sequence and no flat pool, so every flat
    // check would fire on it. The mode discriminator is what prevents that.
    expect(validateVetoConfigForm({ mode: "slots", slots: [{ candidates: [1, 2] }] })).toEqual([]);
  });
});

describe("matchesMapName", () => {
  it("folds case, diacritics and the typographic apostrophe", () => {
    expect(normalizeMapName("King’s Row")).toBe("king's row");
    expect(normalizeMapName("Paraíso")).toBe("paraiso");
  });

  // One case per regulation spelling, so a dropped normalization rule names the
  // spelling it broke instead of failing one lump assertion.
  it("matches `Peninsular` against `Antarctic Peninsula`", () => {
    // Lowercase on purpose: the raw spelling would still pass the word-prefix
    // rule without case folding, so this pins both rules at once.
    expect(matchesMapName("Antarctic Peninsula", "peninsular")).toBe(true);
  });

  it("matches `shambali` against `Shambali Monastery`", () => {
    expect(matchesMapName("Shambali Monastery", "shambali")).toBe(true);
  });

  it("matches `Paraiso` against `Paraíso`", () => {
    // Correct case, so only the diacritic strip can be what makes this hold.
    expect(matchesMapName("Paraíso", "Paraiso")).toBe(true);
  });

  it("matches a typed `King's Row` against the catalogue's `King’s Row`", () => {
    // Correct case again: U+2019 against U+0027 is the only difference.
    expect(matchesMapName("King’s Row", "King's Row")).toBe(true);
  });

  it("does not match an unrelated map, and an empty query matches everything", () => {
    expect(matchesMapName("Busan", "Peninsular")).toBe(false);
    expect(matchesMapName("Ilios", "dorado")).toBe(false);
    // A shared opening letter is not a match: the prefix rule runs from the
    // query side, so only a real word of the name can start it.
    expect(matchesMapName("Circuit Royal", "isthmus")).toBe(false);
    expect(matchesMapName("Busan", "   ")).toBe(true);
  });
});

describe("getMapsPlayedCount", () => {
  it("counts picks and the decider, ignoring bans", () => {
    expect(getMapsPlayedCount(BO3_SEQUENCE)).toBe(3);
    expect(getMapsPlayedCount(BO5_SEQUENCE)).toBe(5);
    expect(getMapsPlayedCount(buildBo1Sequence(7))).toBe(1);
  });

  it("reports the truth for a hand-edited sequence instead of its nearest preset", () => {
    expect(getMapsPlayedCount(["ban_first", "pick_first", "pick_second"])).toBe(2);
  });
});

describe("token round-trip", () => {
  it("builds side-agnostic tokens and maps them to message keys", () => {
    expect(buildToken("ban", "first")).toBe("ban_first");
    expect(buildToken("pick", "second")).toBe("pick_second");
    expect(buildToken("decider", "first")).toBe("decider");
    expect(tokenLabelKey("ban_second")).toBe("banSecond");
    expect(tokenLabelKey("pick_first")).toBe("pickFirst");
    expect(tokenLabelKey("decider")).toBe("decider");
  });
});
