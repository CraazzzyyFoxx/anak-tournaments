// Pure model for the tournament creation wizard (/admin/tournaments/new).
// Pattern mirrors [id]/components/draft/setup-model.ts: a const step list,
// back-only navigation and per-step validation kept free of React.

import type { SchedulablePhase } from "@/app/admin/tournaments/[id]/components/tournamentWorkspace.helpers";
import type { TournamentFormFieldsValue } from "@/components/admin/tournaments/TournamentFormFields";

export const WIZARD_STEPS = ["basics", "schedule", "rules", "registration", "review"] as const;

export type WizardStep = (typeof WIZARD_STEPS)[number];

export type WizardSource = "manual" | "challonge";

export interface WizardBasicsState {
  source: WizardSource;
  name: string;
  challongeSlug: string;
  startDate: string;
  endDate: string;
}

// UI state shared by page.tsx and the step components.

export type WizardFormData = TournamentFormFieldsValue & {
  name: string;
  description: string;
  is_league: boolean;
  start_date: string;
  end_date: string;
};

export interface WizardScheduleState {
  phase_schedule: Record<SchedulablePhase, { starts_at: string; ends_at: string }>;
  auto_transitions_enabled: boolean;
  allow_late_registration: boolean;
}

export interface WizardRegistrationState {
  is_open: boolean;
  auto_approve: boolean;
  require_open_profile: boolean;
}

/** Registration step is only offered to organizers who can manage teams (D17). */
export function visibleWizardSteps(canTeamImport: boolean): WizardStep[] {
  return WIZARD_STEPS.filter((step) => step !== "registration" || canTeamImport);
}

/** Basics is the only step that must be completed; everything else is optional. */
export function isWizardStepRequired(step: WizardStep): boolean {
  return step === "basics";
}

export function validateWizardStep(step: WizardStep, basics: WizardBasicsState): string[] {
  if (step !== "basics") return [];
  const errors: string[] = [];
  if (basics.source === "challonge") {
    if (!basics.challongeSlug.trim()) errors.push("challonge_slug_required");
  } else if (!basics.name.trim()) {
    errors.push("name_required");
  }
  if (!basics.startDate || !basics.endDate) errors.push("dates_required");
  return errors;
}

/** "Create now" (create with defaults for steps 2-4) unlocks once basics is valid. */
export function canCreateNow(basics: WizardBasicsState): boolean {
  return validateWizardStep("basics", basics).length === 0;
}

/** Stepper clicks may only go backwards; forward movement goes through Continue. */
export function canNavigateToWizardStep(
  steps: WizardStep[],
  current: WizardStep,
  target: WizardStep
): boolean {
  return steps.indexOf(target) <= steps.indexOf(current);
}

export function previousWizardStep(steps: WizardStep[], current: WizardStep): WizardStep {
  return steps[Math.max(0, steps.indexOf(current) - 1)];
}

export function nextWizardStep(steps: WizardStep[], current: WizardStep): WizardStep {
  return steps[Math.min(steps.length - 1, steps.indexOf(current) + 1)];
}
