"use client";

import {
  SCHEDULABLE_PHASES,
  type SchedulablePhase
} from "@/app/admin/tournaments/[id]/components/tournamentWorkspace.helpers";
import type { DivisionGridVersion } from "@/types/workspace.types";

import type {
  WizardFormData,
  WizardRegistrationState,
  WizardScheduleState,
  WizardSource
} from "../wizard-model";

interface ReviewStepProps {
  source: WizardSource;
  challongeSlug: string;
  form: WizardFormData;
  schedule: WizardScheduleState;
  registration: WizardRegistrationState;
  registrationVisible: boolean;
  divisionGridVersions: DivisionGridVersion[];
}

const PHASE_LABELS: Record<SchedulablePhase, string> = {
  registration: "Registration",
  draft: "Draft",
  check_in: "Check-in",
  live: "Live"
};

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-border/30 py-2 last:border-b-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm font-medium text-right">{value}</dd>
    </div>
  );
}

export function ReviewStep({
  source,
  challongeSlug,
  form,
  schedule,
  registration,
  registrationVisible,
  divisionGridVersions
}: ReviewStepProps) {
  const gridLabel =
    form.division_grid_version_id == null
      ? "Workspace default"
      : (divisionGridVersions.find((version) => version.id === form.division_grid_version_id)
          ?.label ?? `#${form.division_grid_version_id}`);
  const scheduledPhases = SCHEDULABLE_PHASES.filter(
    (phase) => schedule.phase_schedule[phase].starts_at
  );

  return (
    <div className="space-y-6">
      <section>
        <p className="mb-1 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
          Basics
        </p>
        <dl>
          <Row label="Source" value={source === "challonge" ? "From Challonge" : "Manual"} />
          {source === "challonge" ? (
            <Row label="Challonge" value={challongeSlug || "—"} />
          ) : (
            <Row label="Name" value={form.name || "—"} />
          )}
          <Row label="Dates" value={`${form.start_date || "—"} → ${form.end_date || "—"}`} />
          <Row label="League" value={form.is_league ? "Yes" : "No"} />
        </dl>
      </section>

      <section>
        <p className="mb-1 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
          Schedule
        </p>
        <dl>
          {scheduledPhases.length === 0 && <Row label="Phase schedule" value="Not configured" />}
          {scheduledPhases.map((phase) => (
            <Row
              key={phase}
              label={PHASE_LABELS[phase]}
              value={`${schedule.phase_schedule[phase].starts_at}${
                schedule.phase_schedule[phase].ends_at
                  ? ` → ${schedule.phase_schedule[phase].ends_at}`
                  : ""
              }`}
            />
          ))}
          <Row
            label="Automatic transitions"
            value={schedule.auto_transitions_enabled ? "On" : "Off"}
          />
          <Row
            label="Late registration"
            value={schedule.allow_late_registration ? "Allowed" : "Off"}
          />
        </dl>
      </section>

      <section>
        <p className="mb-1 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
          Rules
        </p>
        <dl>
          <Row
            label="Team formation"
            value={form.team_formation === "draft" ? "Live draft" : "Auto-balance (Balancer)"}
          />
          <Row label="Division grid" value={gridLabel} />
          <Row
            label="Scoring (W / D / L)"
            value={`${form.win_points ?? 1} / ${form.draw_points ?? 0.5} / ${form.loss_points ?? 0}`}
          />
        </dl>
      </section>

      {registrationVisible && (
        <section>
          <p className="mb-1 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            Registration
          </p>
          <dl>
            <Row label="Registration" value={registration.is_open ? "Open" : "Closed"} />
            <Row label="Auto-approve" value={registration.auto_approve ? "On" : "Off"} />
            <Row
              label="Require open profile"
              value={registration.require_open_profile ? "Yes" : "No"}
            />
          </dl>
        </section>
      )}
    </div>
  );
}
