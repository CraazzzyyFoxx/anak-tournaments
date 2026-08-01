import { describe, expect, it } from "vitest";

import type { TournamentReadiness } from "@/types/admin.types";

import { buildChecklist, type ChecklistContext, type ChecklistItem } from "./tournament-checklist";

function readiness(overrides: Partial<TournamentReadiness> = {}): TournamentReadiness {
  return {
    tournament_id: 7,
    status: "registration",
    team_formation: "balancer",
    schedule_configured: true,
    grid_selected: true,
    stages_total: 2,
    stage_slots_filled: true,
    bracket_generated: true,
    encounters_total: 10,
    encounters_with_logs: 0,
    logs_used: false,
    registration_form_configured: true,
    registration_open: true,
    registrations_pending: 1,
    registrations_approved: 3,
    registrations_checked_in: 3,
    registrations_ranked: 3,
    pool_ready: 3,
    pool_need_fix: 0,
    balance_saved: false,
    balance_exported_at: null,
    draft_session_status: null,
    ...overrides
  };
}

/** team.read group fully masked by the backend (D16). */
const TEAM_MASKED: Partial<TournamentReadiness> = {
  registration_form_configured: null,
  registration_open: null,
  registrations_pending: null,
  registrations_approved: null,
  registrations_checked_in: null,
  registrations_ranked: null,
  pool_ready: null,
  pool_need_fix: null,
  balance_saved: null,
  balance_exported_at: null,
  draft_session_status: null
};

/** tournament.read group fully masked by the backend (D16). */
const SETUP_MASKED: Partial<TournamentReadiness> = {
  schedule_configured: null,
  grid_selected: null,
  stages_total: null,
  stage_slots_filled: null,
  bracket_generated: null,
  encounters_total: null,
  encounters_with_logs: null,
  logs_used: null
};

function ctx(overrides: Partial<ChecklistContext> = {}): ChecklistContext {
  return {
    basePath: "/admin/tournaments/7",
    schedule: ["registration", "check_in", "live"],
    hasChallongeSource: false,
    ...overrides
  };
}

function byKey(items: ChecklistItem[], key: string): ChecklistItem {
  const item = items.find((candidate) => candidate.key === key);
  if (!item) throw new Error(`checklist item "${key}" not found`);
  return item;
}

describe("buildChecklist", () => {
  it("registration items are no-access when readiness registration fields are null", () => {
    const items = buildChecklist(readiness(TEAM_MASKED), ctx());
    for (const key of [
      "registration_form",
      "registration_open",
      "approved",
      "ranks",
      "check_in",
      "pool_ready",
      "balance_saved",
      "balance_exported"
    ]) {
      expect(byKey(items, key).state, key).toBe("no-access");
    }
  });

  it("setup and bracket items are no-access when tournament fields are null", () => {
    const items = buildChecklist(readiness(SETUP_MASKED), ctx());
    for (const key of ["schedule", "grid", "stages", "slots", "bracket", "logs"]) {
      expect(byKey(items, key).state, key).toBe("no-access");
    }
  });

  it("check-in item skipped when phase absent from schedule", () => {
    const withoutCheckIn = buildChecklist(
      readiness(),
      ctx({ schedule: ["registration", "live"] })
    );
    expect(byKey(withoutCheckIn, "check_in").state).toBe("skipped");

    const withCheckIn = buildChecklist(readiness(), ctx());
    expect(byKey(withCheckIn, "check_in").state).toBe("done");
  });

  it("logs item neutral when logs_used=false", () => {
    const notUsed = buildChecklist(readiness({ logs_used: false }), ctx());
    expect(byKey(notUsed, "logs").state).toBe("skipped");
    expect(byKey(notUsed, "logs").detail).toBe("Logs: not used");

    const partial = buildChecklist(
      readiness({ logs_used: true, encounters_with_logs: 4, encounters_total: 10 }),
      ctx()
    );
    expect(byKey(partial, "logs").state).toBe("warn");

    const full = buildChecklist(
      readiness({ logs_used: true, encounters_with_logs: 10, encounters_total: 10 }),
      ctx()
    );
    expect(byKey(full, "logs").state).toBe("done");
  });

  it("formation items follow team_formation", () => {
    const balancer = buildChecklist(readiness({ team_formation: "balancer" }), ctx());
    expect(balancer.some((item) => item.key === "pool_ready")).toBe(true);
    expect(balancer.some((item) => item.key === "balance_saved")).toBe(true);
    expect(balancer.some((item) => item.key === "balance_exported")).toBe(true);
    expect(balancer.some((item) => item.key === "draft_completed")).toBe(false);

    const draft = buildChecklist(
      readiness({ team_formation: "draft", draft_session_status: "completed" }),
      ctx()
    );
    expect(draft.some((item) => item.key === "pool_ready")).toBe(false);
    expect(draft.some((item) => item.key === "balance_saved")).toBe(false);
    expect(byKey(draft, "draft_completed").state).toBe("done");

    const draftPending = buildChecklist(
      readiness({ team_formation: "draft", draft_session_status: "live" }),
      ctx()
    );
    expect(byKey(draftPending, "draft_completed").state).toBe("todo");
  });

  it("archived never warns", () => {
    for (const status of ["registration", "live", "playoffs", "completed"]) {
      const item = byKey(buildChecklist(readiness({ status }), ctx()), "archived");
      expect(item.state, status).toBe("skipped");
    }
    expect(
      byKey(buildChecklist(readiness({ status: "archived" }), ctx()), "archived").state
    ).toBe("done");
  });

  it("approved is informational without threshold", () => {
    const empty = buildChecklist(
      readiness({ registrations_approved: 0, registrations_pending: 0 }),
      ctx()
    );
    expect(byKey(empty, "approved").state).toBe("done");

    const filled = buildChecklist(readiness({ registrations_approved: 12 }), ctx());
    expect(byKey(filled, "approved").state).toBe("done");
  });

  it("pool warns when registrations need fixing", () => {
    const items = buildChecklist(readiness({ pool_ready: 5, pool_need_fix: 2 }), ctx());
    expect(byKey(items, "pool_ready").state).toBe("warn");
  });

  it("registration form items hidden for challonge-sourced tournaments", () => {
    const items = buildChecklist(readiness(), ctx({ hasChallongeSource: true }));
    expect(items.some((item) => item.key === "registration_form")).toBe(false);
    expect(items.some((item) => item.key === "registration_open")).toBe(false);
  });

  it("hrefs point at final tab addresses (D20)", () => {
    const items = buildChecklist(readiness({ logs_used: true }), ctx());
    expect(byKey(items, "approved").href).toBe("/admin/tournaments/7/registration");
    expect(byKey(items, "pool_ready").href).toBe("/admin/tournaments/7/teams");
    expect(byKey(items, "stages").href).toBe("/admin/tournaments/7/stages");
    expect(byKey(items, "logs").href).toBe("/admin/tournaments/7/matches?tab=logs");
  });

  it("completion tracks the state machine status", () => {
    const before = buildChecklist(readiness({ status: "playoffs" }), ctx());
    expect(byKey(before, "completed").state).toBe("todo");
    expect(byKey(before, "activation").state).toBe("done");

    const after = buildChecklist(readiness({ status: "completed" }), ctx());
    expect(byKey(after, "completed").state).toBe("done");
  });
});
