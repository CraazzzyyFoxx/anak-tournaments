import { describe, expect, it } from "vitest";

import type { RankSeries } from "@/types/rank.types";

import { chartRows, formatLolRank, isLone } from "./lol-rank";

const point = (at: string, rank_value: number): RankSeries["points"][number] => ({
  captured_at: at,
  rank_value,
  division: "GOLD",
  tier: 2,
  is_ranked: true,
  season: null,
  lp: 50,
  wins: 1,
  losses: 1
});
const unranked = (at: string): RankSeries["points"][number] => ({
  ...point(at, 0),
  rank_value: null,
  division: null,
  tier: null,
  is_ranked: false
});
const series = (queue: string, points: RankSeries["points"], account = 1): RankSeries => ({
  social_account_id: account,
  handle: "A#EUW",
  role: null,
  platform: null,
  queue,
  points,
  current: points.at(-1) ?? null,
  peak_rank_value: null,
  latest_captured_at: null
});

describe("formatLolRank", () => {
  it("names a divisional rank with its roman division", () => {
    expect(formatLolRank({ division: "DIAMOND", tier: 1 })).toBe("Diamond I");
  });
  it("names an apex rank without a division", () => {
    expect(formatLolRank({ division: "GRANDMASTER", tier: null })).toBe("Grandmaster");
  });
  it("has no name for an unranked row", () => {
    expect(formatLolRank({ division: null, tier: null })).toBeNull();
  });
});

describe("chartRows", () => {
  it("merges the Solo and Flex series by time, each row holding both queues' value until it changes", () => {
    const rows = chartRows([
      series("solo", [point("2026-10-01T00:00:00Z", 1250), point("2026-10-03T00:00:00Z", 1310)]),
      series("flex", [point("2026-10-02T00:00:00Z", 900)])
    ]);
    expect(rows).toEqual([
      { at: Date.parse("2026-10-01T00:00:00Z"), solo: 1250 },
      { at: Date.parse("2026-10-02T00:00:00Z"), solo: 1250, flex: 900 },
      { at: Date.parse("2026-10-03T00:00:00Z"), solo: 1310, flex: 900 }
    ]);
  });

  it("plots a queue as the best of every account's last known value, never zig-zagging between accounts", () => {
    const rows = chartRows([
      series("solo", [point("2026-10-01T00:00:00Z", 1000), point("2026-10-03T00:00:00Z", 1400)], 1),
      series("solo", [point("2026-10-02T00:00:00Z", 1200), point("2026-10-04T00:00:00Z", 1100)], 2)
    ]);
    expect(rows).toEqual([
      { at: Date.parse("2026-10-01T00:00:00Z"), solo: 1000 },
      { at: Date.parse("2026-10-02T00:00:00Z"), solo: 1200 },
      { at: Date.parse("2026-10-03T00:00:00Z"), solo: 1400 },
      { at: Date.parse("2026-10-04T00:00:00Z"), solo: 1400 }
    ]);
  });

  it("keeps the best of two accounts captured at the same moment, whichever comes last", () => {
    const rows = chartRows([
      series("flex", [point("2026-10-01T00:00:00Z", 1300)], 1),
      series("flex", [point("2026-10-01T00:00:00Z", 1000)], 2)
    ]);
    expect(rows).toEqual([{ at: Date.parse("2026-10-01T00:00:00Z"), flex: 1300 }]);
  });

  it("drops an account that goes unranked, so another account's lower rank shows", () => {
    const rows = chartRows([
      series("solo", [point("2026-10-01T00:00:00Z", 2775), unranked("2026-10-02T00:00:00Z")], 1),
      series("solo", [point("2026-10-03T00:00:00Z", 900)], 2)
    ]);
    expect(rows).toEqual([
      { at: Date.parse("2026-10-01T00:00:00Z"), solo: 2775 },
      { at: Date.parse("2026-10-02T00:00:00Z"), solo: null },
      { at: Date.parse("2026-10-03T00:00:00Z"), solo: 900 }
    ]);
  });

  it("leaves a gap once the only ranked account goes unranked", () => {
    const rows = chartRows([series("solo", [point("2026-10-01T00:00:00Z", 1500), unranked("2026-10-02T00:00:00Z")])]);
    expect(rows).toEqual([
      { at: Date.parse("2026-10-01T00:00:00Z"), solo: 1500 },
      { at: Date.parse("2026-10-02T00:00:00Z"), solo: null }
    ]);
  });
});

describe("isLone", () => {
  it("marks only a ranked point with no ranked neighbour", () => {
    const points = [{ value: 1 }, { value: null }, { value: 2 }, { value: 2 }, {}, { value: 3 }];
    expect(points.map((_, index) => isLone(points, index))).toEqual([true, false, false, false, false, true]);
  });
});
