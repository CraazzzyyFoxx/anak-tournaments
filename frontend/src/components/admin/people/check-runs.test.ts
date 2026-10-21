import { describe, expect, it } from "vitest";

import type { SubscriptionCheckLogRow } from "@/types/admin.types";

import { collapseCheckRuns } from "./check-runs";

const check = (id: number, over: Partial<SubscriptionCheckLogRow> = {}): SubscriptionCheckLogRow => ({
  id,
  workspace_id: 6,
  auth_user_id: 1,
  user_id: 599,
  user_name: "player",
  provider: "boosty",
  state: "active",
  tier_rank: 1,
  tier_label: "Уровень 1",
  source: "scheduled",
  mechanism: "resolver",
  reason: null,
  error: null,
  created_at: `2026-10-${String(30 - id).padStart(2, "0")}T12:00:00Z`,
  ...over
});

const ids = (runs: SubscriptionCheckLogRow[][]) => runs.map((run) => run.map((row) => row.id));

describe("collapseCheckRuns", () => {
  it("folds identical checks and gives a state change its own row", () => {
    const rows = [check(1), check(2), check(3, { state: "inactive" }), check(4), check(5)];
    expect(ids(collapseCheckRuns(rows))).toEqual([[1, 2], [3], [4, 5]]);
  });

  it("splits on tier, reason, error and source", () => {
    const rows = [
      check(1),
      check(2, { tier_rank: 2, tier_label: "Уровень 2" }),
      check(3, { reason: "not_subscribed" }),
      check(4, { error: "timeout" }),
      check(5, { source: "manual" })
    ];
    expect(ids(collapseCheckRuns(rows))).toEqual([[1], [2], [3], [4], [5]]);
  });

  it("does not let another provider's check break a run", () => {
    const rows = [check(1), check(2, { provider: "twitch" }), check(3), check(4, { provider: "twitch" })];
    expect(ids(collapseCheckRuns(rows))).toEqual([[1, 3], [2, 4]]);
  });

  it("returns nothing for an empty log", () => {
    expect(collapseCheckRuns([])).toEqual([]);
  });
});
