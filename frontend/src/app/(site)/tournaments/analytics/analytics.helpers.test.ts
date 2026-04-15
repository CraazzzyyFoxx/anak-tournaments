import { describe, expect, it } from "bun:test";

import {
  canShowAnalyticsAdminToolbar,
  getAnalyticsRefreshKeys,
  getPreferredAnalyticsAlgorithmId,
} from "@/app/(site)/tournaments/analytics/analytics.helpers";

describe("analytics helpers", () => {
  it("shows the admin toolbar only for users with analytics.update access", () => {
    expect(canShowAnalyticsAdminToolbar(true)).toBe(true);
    expect(canShowAnalyticsAdminToolbar(false)).toBe(false);
  });

  it("prefers Linear Stable as the default analytics algorithm", () => {
    expect(
      getPreferredAnalyticsAlgorithmId([
        { id: 1, name: "Points" },
        { id: 2, name: "Open Skill" },
        { id: 3, name: "Linear Hybrid" },
        { id: 4, name: "Linear Stable" },
      ]),
    ).toBe(4);
  });

  it("returns the analytics queries that must be invalidated after recalculate", () => {
    expect(getAnalyticsRefreshKeys(42, 7)).toEqual([
      ["analytics", 42],
      ["analytics", 42, 7],
    ]);

    expect(getAnalyticsRefreshKeys(42, null)).toEqual([["analytics", 42]]);
  });
});
