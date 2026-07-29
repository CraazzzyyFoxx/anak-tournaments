import { describe, expect, it } from "vitest";

import {
  canCreateNow,
  canNavigateToWizardStep,
  isWizardStepRequired,
  nextWizardStep,
  previousWizardStep,
  validateWizardStep,
  visibleWizardSteps,
  WIZARD_STEPS,
  type WizardBasicsState
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
