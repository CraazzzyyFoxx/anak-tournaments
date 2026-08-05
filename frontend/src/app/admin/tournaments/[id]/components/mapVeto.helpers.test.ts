import { describe, expect, it } from "vitest";

import {
  BO3_SEQUENCE,
  BO5_SEQUENCE,
  buildBo1Sequence,
  buildToken,
  getMapsPlayedCount,
  tokenLabelKey,
  validateVetoConfigForm
} from "./mapVeto.helpers";

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
        validateVetoConfigForm(sequence, Array.from({ length: size }, (_, i) => i + 1))
      ).toEqual([]);
    }
  });
});

describe("preset sequences", () => {
  it("Bo3 and Bo5 are valid against a matching pool", () => {
    expect(validateVetoConfigForm(BO3_SEQUENCE, [1, 2, 3, 4, 5])).toEqual([]);
    expect(validateVetoConfigForm(BO5_SEQUENCE, [1, 2, 3, 4, 5, 6, 7])).toEqual([]);
  });
});

describe("validateVetoConfigForm", () => {
  it("rejects an empty pool and empty sequence", () => {
    expect(validateVetoConfigForm([], [])).toEqual([
      { key: "emptyPool" },
      { key: "emptySequence" }
    ]);
  });

  it("rejects multiple deciders", () => {
    expect(validateVetoConfigForm(["decider", "decider"], [1, 2])).toContainEqual({
      key: "multipleDeciders"
    });
  });

  it("rejects a decider that is not the last step", () => {
    expect(validateVetoConfigForm(["decider", "ban_first"], [1, 2, 3])).toContainEqual({
      key: "deciderNotLast"
    });
  });

  it("reports the step and map counts when the sequence outgrows the pool", () => {
    expect(validateVetoConfigForm(BO3_SEQUENCE, [1, 2, 3])).toContainEqual({
      key: "sequenceLongerThanPool",
      values: { steps: 5, maps: 3 }
    });
  });

  it("rejects ban-only sequences", () => {
    expect(validateVetoConfigForm(["ban_first", "ban_second"], [1, 2, 3])).toContainEqual({
      key: "noPickOrDecider"
    });
  });

  it("accepts a pick-based sequence without a decider", () => {
    expect(validateVetoConfigForm(["pick_first", "pick_second"], [1, 2, 3])).toEqual([]);
  });

  it("returns keys, never prose, so both locales render the same issue", () => {
    for (const issue of validateVetoConfigForm(["decider", "ban_first"], [])) {
      expect(typeof issue.key).toBe("string");
      expect(issue.key).toMatch(/^[a-z][A-Za-z]+$/);
    }
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
