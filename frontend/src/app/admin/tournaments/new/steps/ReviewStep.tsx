"use client";

import type { ReactNode } from "react";
import { Check } from "lucide-react";
import { useTranslations } from "next-intl";
import { StatusIcon } from "@/components/admin/StatusIcon";
import { useRequirementDescription } from "@/components/admin/subscriptions/useRequirementDescription";
import { EYEBROW_CLASS } from "@/components/kit/tone";
import { formatDateRange } from "@/lib/datetime";
import { useFormatter } from "@/lib/datetime/client";
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

/** Same labels the Basics step offers, so the summary cannot rename a choice.
 *  A ternary here used to read every non-draft formation as "Auto-balance". */
const TEAM_FORMATION_LABELS: Record<string, "balancer" | "draft" | "registration" | "solo"> = {
  balancer: "balancer",
  draft: "draft",
  registration: "registration",
  solo: "solo"
};

/** A fact row; an empty value renders no row at all. */
function Row({ label, value }: Readonly<{ label: string; value: ReactNode }>) {
  if (value === null || value === undefined || value === false || value === "") return null;
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
  const format = useFormatter();
  const requirementRule = useRequirementDescription(subscriptionRequirement);
  // A boolean is shown only when it is on, as a check: no Yes/No words.
  const enabled = <StatusIcon icon={Check} label={t("enabled")} variant="success" />;
  const gridLabel =
    form.division_grid_version_id == null
      ? t("workspaceDefault")
      : (divisionGridVersions.find((version) => version.id === form.division_grid_version_id)
          ?.label ?? `#${form.division_grid_version_id}`);
  const scheduledPhases = SCHEDULABLE_PHASES.filter(
    (phase) => schedule.phase_schedule[phase].starts_at
  );
  const hasSchedule = scheduledPhases.length > 0 || schedule.auto_transitions_enabled;

  return (
    <div className="space-y-6">
      <section>
        <h3 className={`mb-1 ${EYEBROW_CLASS}`}>{t("basics")}</h3>
        <dl>
          <Row label={t("source")} value={source === "challonge" ? t("fromChallonge") : t("manual")} />
          {source === "challonge" ? (
            <Row label={t("challongeUrlOrSlug")} value={challongeSlug} />
          ) : (
            <Row label={t("name")} value={form.name} />
          )}
          <Row
            label={t("dateRange")}
            value={
              form.start_date && form.end_date
                ? formatDateRange(format, form.start_date, form.end_date)
                : null
            }
          />
          <Row label={t("leagueSeason")} value={form.is_league && enabled} />
        </dl>
      </section>

      {hasSchedule ? (
        <section>
          <h3 className={`mb-1 ${EYEBROW_CLASS}`}>{t("schedule")}</h3>
          <dl>
            {scheduledPhases.map((phase) => {
              const { starts_at, ends_at } = schedule.phase_schedule[phase];
              return (
                <Row
                  key={phase}
                  label={t(`phases.${phase}`)}
                  value={ends_at ? t("range", { start: starts_at, end: ends_at }) : starts_at}
                />
              );
            })}
            <Row
              label={t("automaticTransitions")}
              value={schedule.auto_transitions_enabled && enabled}
            />
          </dl>
        </section>
      ) : null}

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
            <Row label={t("autoApprove")} value={registration.auto_approve && enabled} />
            <Row label={t("openProfile")} value={registration.require_open_profile && enabled} />
            {/* The composed workspace rule, not a bare check: an organizer
                reviewing the draft needs to see what the toggle will enforce. */}
            <Row
              label={t("subscription")}
              value={
                registration.require_subscription
                  ? requirementRule || t("subscriptionMissingRule")
                  : null
              }
            />
          </dl>
        </section>
      )}
    </div>
  );
}
