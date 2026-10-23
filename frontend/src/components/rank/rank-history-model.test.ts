import { describe, expect, it } from "vitest";

import type { NativeTier } from "@/types/discipline.types";
import type { CurrentRank, RankSeries } from "@/types/rank.types";

import { bestCurrent, chartRows, isLone, rankAxis } from "./rank-history-model";

const point = (at: string, rank_value: number | null): RankSeries["points"][number] => ({
  captured_at: at,
  rank_value,
  division: null,
  tier: null,
  is_ranked: rank_value != null,
  season: null
});
const series = (points: RankSeries["points"], account = 1): RankSeries => ({
  social_account_id: account,
  handle: `acc${account}`,
  role: null,
  platform: null,
  points,
  current: points.at(-1) ?? null,
  peak_rank_value: null,
  latest_captured_at: null
});
const current = (overrides: Partial<CurrentRank>): CurrentRank => ({
  ...point("2026-10-01T00:00:00Z", 1000),
  social_account_id: 1,
  handle: "acc1",
  role: null,
  platform: null,
  ...overrides
});
const tier = (rank_min: number, rank_max: number | null, name: string) => ({ rank_min, rank_max, name }) as NativeTier;

describe("chartRows", () => {
  it("merges lines by time, carrying each line's last value and marking an unranked stretch null", () => {
    const rows = chartRows([
      { key: "a", series: series([point("2026-10-01T00:00:00Z", 100), point("2026-10-03T00:00:00Z", null)]) },
      { key: "b", series: series([point("2026-10-02T00:00:00Z", 200)], 2) }
    ]);
    expect(rows).toEqual([
      { at: Date.parse("2026-10-01T00:00:00Z"), a: 100 },
      { at: Date.parse("2026-10-02T00:00:00Z"), a: 100, b: 200 },
      { at: Date.parse("2026-10-03T00:00:00Z"), a: null, b: 200 }
    ]);
  });
});

describe("bestCurrent", () => {
  it("keeps the best ranked account per line on the platform, an unranked row only when nothing is ranked", () => {
    const best = bestCurrent(
      [
        current({ role: "tank", platform: "pc", rank_value: 1500 }),
        current({ role: "tank", platform: "pc", social_account_id: 2, rank_value: 2500 }),
        current({ role: "tank", platform: "console", rank_value: 4000 }),
        current({ role: "support", platform: "pc", rank_value: null, is_ranked: false })
      ],
      "pc"
    );
    expect(best.get("tank")?.rank_value).toBe(2500);
    expect(best.get("support")?.is_ranked).toBe(false);
  });
});

describe("rankAxis", () => {
  const ladder = [tier(300, null, "Top"), tier(200, 299, "Mid"), tier(100, 199, "Low"), tier(0, 99, "Floor")];

  it("spans from the floor under the lowest value to the floor above the highest, ticked on floors", () => {
    expect(rankAxis(ladder, [{ at: 0, a: 150 }, { at: 1, a: 250 }])).toEqual({ domain: [100, 300], ticks: [100, 200, 300] });
  });
});

describe("isLone", () => {
  it("dots a ranked point only when both neighbours are unranked", () => {
    const points = [{ value: null }, { value: 5 }, { value: null }, { value: 6 }, { value: 7 }];
    expect([0, 1, 2, 3, 4].map((index) => isLone(points, index))).toEqual([false, true, false, false, false]);
  });
});
