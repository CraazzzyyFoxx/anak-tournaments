import { describe, expect, it } from "bun:test";

import {
  getTournamentRealtimeUpdatePlan,
  parseTournamentRealtimeMessage,
} from "@/hooks/tournamentRealtime.helpers";

describe("tournament realtime helpers", () => {
  it("parses tournament update websocket messages for the active tournament", () => {
    const message = parseTournamentRealtimeMessage(
      JSON.stringify({
        type: "tournament:updated",
        data: {
          tournament_id: 42,
          reason: "results_changed",
        },
      }),
      42
    );

    expect(message).toEqual({
      tournamentId: 42,
      reason: "results_changed",
    });
  });

  it("builds the invalidation plan for results updates without requiring a route refresh", () => {
    const plan = getTournamentRealtimeUpdatePlan(42, 7, "results_changed");

    expect(plan.invalidateAdminWorkspace).toBe(true);
    expect(plan.shouldRefreshRoute).toBe(false);
    expect(plan.queryKeys).toContainEqual(["standings", 42]);
    expect(plan.queryKeys).toContainEqual(["standings-table", 42]);
    expect(plan.queryKeys).toContainEqual(["encounters", "tournament", 42]);
    expect(plan.queryKeys).toContainEqual(["standings", 42, 7]);
    expect(plan.queryKeys).toContainEqual(["encounters", "tournament", 42, 7]);
  });

  it("marks structure updates as requiring a route refresh", () => {
    const plan = getTournamentRealtimeUpdatePlan(42, 7, "structure_changed");

    expect(plan.shouldRefreshRoute).toBe(true);
  });
});
