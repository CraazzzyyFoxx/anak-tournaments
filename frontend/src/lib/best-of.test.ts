import { describe, expect, it } from "vitest";

import {
  BEST_OF_OPTIONS,
  DEFAULT_BEST_OF,
  buildSequenceForBestOf,
  hasPerRoundBestOf,
  parseStageBestOf,
  resolveBestOf
} from "./best-of";

/**
 * These cases are deliberately the same ones as the backend's
 * `tests/test_best_of.py` and `tests/test_veto_session.py`. The veto room runs
 * the sequence the SERVER generates, so any divergence here is a UI previewing
 * steps the captains will never be asked to take — the tests exist to catch
 * that drift, not just to exercise the functions.
 */

const playedMaps = (sequence: string[]) =>
  sequence.filter((token) => !token.startsWith("ban")).length;

describe("parseStageBestOf", () => {
  it("degrades to an empty config for anything malformed", () => {
    for (const bad of [null, undefined, {}, { best_of: null }, { best_of: [] }, { best_of: "bo3" }]) {
      expect(parseStageBestOf(bad)).toEqual({});
    }
  });

  it("reads default, by_round and final", () => {
    expect(parseStageBestOf({ best_of: { default: 3, by_round: { "1": 2, "3": 5 }, final: 7 } })).toEqual(
      { default: 3, by_round: { "1": 2, "3": 5 }, final: 7 }
    );
  });

  it("drops invalid values and non-numeric round keys, like the server", () => {
    // default 0 is < 1, final true is a bool, "x" is not a round, 2 -> 0 is < 1.
    expect(
      parseStageBestOf({
        best_of: { default: 0, final: true, by_round: { "1": 2, x: 5, "2": 0, "3": true } }
      })
    ).toEqual({ by_round: { "1": 2 } });
  });
});

describe("resolveBestOf", () => {
  it("falls back to the default, then to 3", () => {
    expect(resolveBestOf({ default: 2 }, 4)).toBe(2);
    expect(resolveBestOf({}, 4)).toBe(DEFAULT_BEST_OF);
  });

  it("prefers a by_round override over the default", () => {
    const config = { default: 3, by_round: { "1": 2 } };
    expect(resolveBestOf(config, 1)).toBe(2);
    expect(resolveBestOf(config, 2)).toBe(3);
  });

  it("lets final win only when the round is flagged final", () => {
    const config = { default: 3, by_round: { "2": 3 }, final: 5 };
    expect(resolveBestOf(config, 2, { isFinal: true })).toBe(5);
    expect(resolveBestOf(config, 2, { isFinal: false })).toBe(3);
  });

  it("ignores an unset final on a final round", () => {
    expect(resolveBestOf({ default: 3 }, 9, { isFinal: true })).toBe(3);
  });
});

describe("hasPerRoundBestOf", () => {
  it("is true only when some round differs from the default", () => {
    expect(hasPerRoundBestOf({ default: 3 })).toBe(false);
    expect(hasPerRoundBestOf({ default: 3, by_round: { "1": 2 } })).toBe(true);
    expect(hasPerRoundBestOf({ default: 3, final: 5 })).toBe(true);
  });
});

describe("buildSequenceForBestOf", () => {
  it("reproduces the presets the editor used to hardcode", () => {
    expect(buildSequenceForBestOf(2, 4)).toEqual([
      "ban_first",
      "ban_second",
      "pick_first",
      "pick_second"
    ]);
    expect(buildSequenceForBestOf(3, 5)).toEqual([
      "ban_first",
      "ban_second",
      "pick_first",
      "pick_second",
      "decider"
    ]);
    expect(buildSequenceForBestOf(5, 7)).toEqual([
      "ban_first",
      "ban_second",
      "pick_first",
      "pick_second",
      "pick_first",
      "pick_second",
      "decider"
    ]);
  });

  it("bans the pool down to one map for Bo1", () => {
    expect(buildSequenceForBestOf(1, 5)).toEqual([
      "ban_first",
      "ban_second",
      "ban_first",
      "ban_second",
      "decider"
    ]);
  });

  it("covers Bo7, which had no preset at all", () => {
    const sequence = buildSequenceForBestOf(7, 9);
    expect(sequence).toHaveLength(9);
    expect(playedMaps(sequence)).toBe(7);
    expect(sequence[sequence.length - 1]).toBe("decider");
  });

  it("plays exactly bestOf maps and never outgrows the pool", () => {
    for (let bestOf = 1; bestOf <= 7; bestOf += 1) {
      const poolSize = bestOf + 2;
      const sequence = buildSequenceForBestOf(bestOf, poolSize);
      expect(playedMaps(sequence), `bestOf=${bestOf}`).toBe(bestOf);
      expect(sequence.length, `bestOf=${bestOf}`).toBeLessThanOrEqual(poolSize);
    }
  });

  it("drops the opening bans rather than outgrow a tight pool", () => {
    expect(buildSequenceForBestOf(3, 3)).toEqual(["pick_first", "pick_second", "decider"]);
  });

  it("clamps a series longer than the pool", () => {
    const sequence = buildSequenceForBestOf(7, 3);
    expect(sequence.length).toBeLessThanOrEqual(3);
  });

  it("yields nothing for an empty pool", () => {
    expect(buildSequenceForBestOf(3, 0)).toEqual([]);
  });

  it("has a sequence for every length the stage editor offers", () => {
    for (const bestOf of BEST_OF_OPTIONS) {
      const sequence = buildSequenceForBestOf(bestOf, bestOf + 2);
      expect(sequence.length, `Bo${bestOf}`).toBeGreaterThan(0);
      expect(playedMaps(sequence), `Bo${bestOf}`).toBe(bestOf);
    }
  });
});
