"use client";

import {
  SCHEDULABLE_PHASES,
  type SchedulablePhase
} from "@/app/admin/tournaments/[id]/components/tournamentWorkspace.helpers";
import { DateTimePicker } from "@/components/ui/date-picker";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

import type { WizardScheduleState } from "../wizard-model";

// Field set mirrors the Schedule & Timeline card of TournamentSettingsTab;
// that card is inline JSX in a monolithic form, so it is not reusable as-is.
const PHASE_LABELS: Record<SchedulablePhase, string> = {
  registration: "Registration",
  draft: "Draft",
  check_in: "Check-in",
  live: "Live"
};

interface ScheduleStepProps {
  value: WizardScheduleState;
  onChange: (next: WizardScheduleState) => void;
  showDraftPhase: boolean;
}

export function ScheduleStep({ value, onChange, showDraftPhase }: ScheduleStepProps) {
  const visiblePhases = SCHEDULABLE_PHASES.filter(
    (phase) => phase !== "draft" || showDraftPhase
  );

  const setPhaseField = (
    phase: SchedulablePhase,
    field: "starts_at" | "ends_at",
    nextValue: string
  ) =>
    onChange({
      ...value,
      phase_schedule: {
        ...value.phase_schedule,
        [phase]: { ...value.phase_schedule[phase], [field]: nextValue }
      }
    });

  return (
    <div className="space-y-5">
      <div>
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
          Phase Schedule
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          Each phase starts automatically at its start time when automatic transitions are
          enabled. Leave a phase empty to skip scheduling it.
        </p>
      </div>

      {visiblePhases.map((phase) => (
        <div key={phase} className="space-y-2">
          <p className="text-xs font-medium text-foreground">{PHASE_LABELS[phase]}</p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <DateTimePicker
              id={`wizard-phase-${phase}-starts`}
              timeId={`wizard-phase-${phase}-starts-time`}
              dateLabel="Starts at"
              timeLabel="Time"
              value={value.phase_schedule[phase].starts_at}
              onChange={(nextValue) => setPhaseField(phase, "starts_at", nextValue)}
            />
            <DateTimePicker
              id={`wizard-phase-${phase}-ends`}
              timeId={`wizard-phase-${phase}-ends-time`}
              dateLabel="Ends at (optional)"
              timeLabel="Time"
              value={value.phase_schedule[phase].ends_at}
              onChange={(nextValue) => setPhaseField(phase, "ends_at", nextValue)}
            />
          </div>
        </div>
      ))}

      <div className="flex flex-col gap-4 bg-muted/20 border border-border/50 rounded-lg p-3.5">
        <div className="flex items-center justify-between gap-4">
          <div className="space-y-0.5">
            <Label htmlFor="wizard-auto-transitions" className="cursor-pointer text-sm font-medium">
              Automatic phase transitions
            </Label>
            <p className="text-xs text-muted-foreground">
              Phases advance on their own following the schedule above.
            </p>
          </div>
          <Switch
            id="wizard-auto-transitions"
            checked={value.auto_transitions_enabled}
            onCheckedChange={(checked) =>
              onChange({ ...value, auto_transitions_enabled: checked })
            }
          />
        </div>

        <div className="flex items-center justify-between gap-4">
          <div className="space-y-0.5">
            <Label
              htmlFor="wizard-allow-late-registration"
              className="cursor-pointer text-sm font-medium"
            >
              Allow late registration
            </Label>
            <p className="text-xs text-muted-foreground">
              Keep registration open after the registration phase, until the tournament is
              completed.
            </p>
          </div>
          <Switch
            id="wizard-allow-late-registration"
            checked={value.allow_late_registration}
            onCheckedChange={(checked) =>
              onChange({ ...value, allow_late_registration: checked })
            }
          />
        </div>
      </div>
    </div>
  );
}
