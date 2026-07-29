import { describe, expect, it } from "vitest";

import type { Tournament } from "@/types/tournament.types";

import {
  buildDraftCreateInput,
  buildDraftUpdateInput,
  canCreateNow,
  canNavigateToWizardStep,
  findResumableDraft,
  isWizardStepRequired,
  nextWizardStep,
  previousWizardStep,
  stepEntryRequiresDraft,
  validateWizardStep,
  visibleWizardSteps,
  wizardStateFromDraft,
  WIZARD_STEPS,
  type WizardBasicsState,
  type WizardFormData,
  type WizardScheduleState
} from "./wizard-model";

function basics(overrides: Partial<WizardBasicsState> = {}): WizardBasicsState {
  return {
    source: "manual",
    name: "Season 9",
    challongeSlug: "",
    startDate: "2026-08-01",
    endDate: "2026-08-15",
    ...overrides
  };
}

describe("tournament creation wizard model", () => {
  it("defines the five-step flow", () => {
    expect(WIZARD_STEPS).toEqual(["basics", "schedule", "rules", "registration", "review"]);
  });

  it("step 1 is the only required step", () => {
    expect(WIZARD_STEPS.filter(isWizardStepRequired)).toEqual(["basics"]);
    for (const step of WIZARD_STEPS.slice(1)) {
      expect(validateWizardStep(step, basics({ name: "", startDate: "" }))).toEqual([]);
    }
  });

  it("validates basics per source", () => {
    expect(validateWizardStep("basics", basics())).toEqual([]);
    expect(validateWizardStep("basics", basics({ name: "  " }))).toContain("name_required");
    expect(validateWizardStep("basics", basics({ startDate: "", endDate: "" }))).toContain(
      "dates_required"
    );
    expect(
      validateWizardStep("basics", basics({ source: "challonge", name: "" }))
    ).toContain("challonge_slug_required");
    expect(
      validateWizardStep(
        "basics",
        basics({ source: "challonge", name: "", challongeSlug: "my-cup" })
      )
    ).toEqual([]);
  });

  it("create-now available after step 1 valid", () => {
    expect(canCreateNow(basics())).toBe(true);
    expect(canCreateNow(basics({ name: "" }))).toBe(false);
    expect(canCreateNow(basics({ source: "challonge", challongeSlug: "cup" }))).toBe(true);
  });

  it("step 4 hidden without team.import", () => {
    expect(visibleWizardSteps(false)).toEqual(["basics", "schedule", "rules", "review"]);
    expect(visibleWizardSteps(true)).toEqual(WIZARD_STEPS);
  });

  it("navigation is back-only and skips hidden steps", () => {
    const steps = visibleWizardSteps(false);
    expect(canNavigateToWizardStep(steps, "rules", "basics")).toBe(true);
    expect(canNavigateToWizardStep(steps, "rules", "review")).toBe(false);
    expect(nextWizardStep(steps, "rules")).toBe("review");
    expect(previousWizardStep(steps, "review")).toBe("rules");
    expect(previousWizardStep(steps, "basics")).toBe("basics");
    expect(nextWizardStep(visibleWizardSteps(true), "rules")).toBe("registration");
  });
});

// ── T11: lazy Unpublished draft + resume (D4) ──

const form: WizardFormData = {
  name: "  Season 9  ",
  description: "Weekly cup",
  is_league: false,
  start_date: "2026-08-01",
  end_date: "2026-08-15",
  division_grid_version_id: 3,
  team_formation: "draft",
  win_points: 2,
  draw_points: 1,
  loss_points: 0
};

const schedule: WizardScheduleState = {
  phase_schedule: {
    registration: { starts_at: "", ends_at: "" },
    check_in: { starts_at: "", ends_at: "" },
    draft: { starts_at: "", ends_at: "" },
    live: { starts_at: "", ends_at: "" }
  },
  auto_transitions_enabled: false,
  allow_late_registration: true
};

function tournament(overrides: Partial<Tournament> = {}): Tournament {
  return {
    id: 7,
    workspace_id: 1,
    name: "Draft 7",
    description: null,
    challonge_slug: null,
    is_league: false,
    is_finished: false,
    is_hidden: true,
    team_formation: "balancer",
    start_date: "2026-08-01T00:00:00Z",
    end_date: "2026-08-15T00:00:00Z",
    auto_transitions_enabled: true,
    allow_late_registration: false,
    phase_schedule: [],
    win_points: 1,
    draw_points: 0.5,
    loss_points: 0,
    stages: [],
    division_grid_version_id: null,
    ...overrides
  } as unknown as Tournament;
}

describe("lazy Unpublished draft (D4)", () => {
  it("only step 4 and review entry require a draft id", () => {
    expect(WIZARD_STEPS.filter(stepEntryRequiresDraft)).toEqual(["registration", "review"]);
  });

  it("draft create payload is hidden and carries the current form", () => {
    const payload = buildDraftCreateInput(42, form);
    expect(payload.is_hidden).toBe(true);
    expect(payload.workspace_id).toBe(42);
    expect(payload.name).toBe("Season 9");
    expect(payload.start_date).toBe("2026-08-01");
    expect(payload.division_grid_version_id).toBe(3);
  });

  it("draft update payload keeps the draft hidden unless publishing", () => {
    const kept = buildDraftUpdateInput(form, schedule, { publish: false });
    expect(kept.is_hidden).toBeUndefined();
    expect(kept.team_formation).toBe("draft");
    expect(kept.allow_late_registration).toBe(true);
    expect(kept.auto_transitions_enabled).toBe(false);

    const published = buildDraftUpdateInput(form, schedule, { publish: true });
    expect(published.is_hidden).toBe(false);
  });

  it("draft update payload never blanks the name (Challonge names it)", () => {
    const payload = buildDraftUpdateInput({ ...form, name: "  " }, schedule, { publish: true });
    expect(payload.name).toBeUndefined();
  });
});

describe("resume detection (D4)", () => {
  it("picks the latest hidden stage-less tournament of the workspace", () => {
    const candidates = [
      tournament({ id: 3 }),
      tournament({ id: 9 }),
      tournament({ id: 11, is_hidden: false }),
      tournament({ id: 12, workspace_id: 2 }),
      tournament({ id: 13, stages: [{ id: 1 }] as Tournament["stages"] })
    ];
    expect(findResumableDraft(candidates, 1)?.id).toBe(9);
  });

  it("returns null without a workspace or a candidate", () => {
    expect(findResumableDraft([tournament()], null)).toBeNull();
    expect(findResumableDraft([], 1)).toBeNull();
    expect(findResumableDraft([tournament({ is_hidden: false })], 1)).toBeNull();
  });
});

describe("wizardStateFromDraft prefill", () => {
  it("maps tournament fields back into wizard form + schedule state", () => {
    const draft = tournament({
      name: "Resumed",
      description: "desc",
      team_formation: "draft",
      win_points: 3,
      auto_transitions_enabled: false,
      allow_late_registration: true,
      phase_schedule: [
        { status: "registration", starts_at: "2026-08-01T10:00:00Z", ends_at: null }
      ] as Tournament["phase_schedule"]
    });
    const state = wizardStateFromDraft(draft, "UTC");
    expect(state.form.name).toBe("Resumed");
    expect(state.form.description).toBe("desc");
    expect(state.form.start_date).toBe("2026-08-01");
    expect(state.form.team_formation).toBe("draft");
    expect(state.form.win_points).toBe(3);
    expect(state.schedule.auto_transitions_enabled).toBe(false);
    expect(state.schedule.allow_late_registration).toBe(true);
    expect(state.schedule.phase_schedule.registration.starts_at).toBe("2026-08-01T10:00");
    expect(state.schedule.phase_schedule.live.starts_at).toBe("");
  });
});
