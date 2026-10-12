"use client";

import { useRequirementDescription } from "@/components/admin/subscriptions/useRequirementDescription";
import { useTranslations } from "next-intl";
import { EYEBROW_CLASS } from "@/components/kit/tone";
import { SCHEDULABLE_PHASES } from "@/lib/tournament/lifecycle";
import type { SubscriptionRequirement } from "@/types/registration.types";
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
  /** The workspace-wide rule, fetched by the page alongside the division grids.
   *  The wizard no longer carries one: a tournament only chooses whether to
   *  enforce what the workspace already decided. */
  subscriptionRequirement: SubscriptionRequirement | undefined;
}

/** Same labels the Rules step offers, so the summary cannot rename a choice.
 *  A ternary here used to read every non-draft formation as "Auto-balance". */
const TEAM_FORMATION_LABELS: Record<string, "balancer" | "draft" | "registration" | "solo"> = {
  balancer: "balancer",
  draft: "draft",
  registration: "registration",
  solo: "solo"
};

function Row({ label, value }: Readonly<{ label: string; value: string }>) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-border/30 py-2 last:border-b-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-right text-sm font-medium tabular-nums">{value}</dd>
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
  divisionGridVersions,
  subscriptionRequirement
}: Readonly<ReviewStepProps>) {
  const t = useTranslations("adminTournaments.review");
  const requirementRule = useRequirementDescription(subscriptionRequirement);
  const gridLabel =
    form.division_grid_version_id == null
      ? t("workspaceDefault")
      : (divisionGridVersions.find((version) => version.id === form.division_grid_version_id)
          ?.label ?? `#${form.division_grid_version_id}`);
  const scheduledPhases = SCHEDULABLE_PHASES.filter(
    (phase) => schedule.phase_schedule[phase].starts_at
  );

  return (
    <div className="space-y-6">
      <section>
        <h3 className={`mb-1 ${EYEBROW_CLASS}`}>{t("basics")}</h3>
        <dl>
          <Row label={t("source")} value={source === "challonge" ? t("fromChallonge") : t("manual")} />
          {source === "challonge" ? (
            <Row label={t("challongeUrlOrSlug")} value={challongeSlug || "—"} />
          ) : (
            <Row label={t("name")} value={form.name || "—"} />
          )}
          <Row label={t("dateRange")} value={`${form.start_date || "—"} → ${form.end_date || "—"}`} />
          <Row label={t("leagueSeason")} value={form.is_league ? t("yes") : t("no")} />
        </dl>
      </section>

      <section>
        <h3 className={`mb-1 ${EYEBROW_CLASS}`}>{t("schedule")}</h3>
        <dl>
          {scheduledPhases.length === 0 && <Row label={t("phaseSchedule")} value={t("notConfigured")} />}
          {scheduledPhases.map((phase) => (
            <Row
              key={phase}
              label={t(`phases.${phase}`)}
              value={`${schedule.phase_schedule[phase].starts_at}${
                schedule.phase_schedule[phase].ends_at
                  ? ` → ${schedule.phase_schedule[phase].ends_at}`
                  : ""
              }`}
            />
          ))}
          <Row
            label={t("automaticTransitions")}
            value={schedule.auto_transitions_enabled ? t("on") : t("off")}
          />
        </dl>
      </section>

      <section>
        <h3 className={`mb-1 ${EYEBROW_CLASS}`}>{t("rules")}</h3>
        <dl>
          <Row
            label={t("teamFormation")}
            value={t(`formation.${TEAM_FORMATION_LABELS[form.team_formation ?? "balancer"]}`)}
          />
          <Row label={t("divisionGridVersion")} value={gridLabel} />
          <Row
            label={t("scoringPoints")}
            value={`${form.win_points ?? 1} / ${form.draw_points ?? 0.5} / ${form.loss_points ?? 0}`}
          />
        </dl>
      </section>

      {registrationVisible && (
        <section>
          <h3 className={`mb-1 ${EYEBROW_CLASS}`}>{t("registration")}</h3>
          <p className="mb-2 text-xs text-muted-foreground">
            {t("registrationHelp")}
          </p>
          <dl>
            <Row
              label={t("autoApprove")}
              value={registration.auto_approve ? t("on") : t("off")}
            />
            <Row
              label={t("openProfile")}
              value={registration.require_open_profile ? t("yes") : t("no")}
            />
            {/* The composed workspace rule, not a bare Yes/No: an organizer
                reviewing the draft needs to see what the toggle will enforce. */}
            <Row
              label={t("subscription")}
              value={
                registration.require_subscription
                  ? requirementRule || t("subscriptionMissingRule")
                  : t("no")
              }
            />
          </dl>
        </section>
      )}
    </div>
  );
}
