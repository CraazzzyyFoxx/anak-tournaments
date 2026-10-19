"use client";

import { useTranslations } from "next-intl";

import { Card, CardContent } from "@/components/ui/card";
import { DateRangePicker } from "@/components/ui/date-range-picker";
import { DateTimePicker } from "@/components/ui/date-picker";
import { Field, FieldLabel } from "@/components/ui/field";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { EYEBROW_CLASS } from "@/components/kit/tone";
import { SaveBar } from "@/components/kit/SaveBar";
import { getUtcOffsetLabel } from "@/lib/workspace/timezone";
import {
  SCHEDULABLE_PHASES,
  type SchedulablePhase
} from "@/lib/tournament/lifecycle";
import type { Tournament } from "@/types/tournament.types";
import { SettingsSectionPage } from "../SettingsSection";
import { useTournamentSettingsForm } from "../useTournamentSettingsForm";

export default function ScheduleSettingsPage() {
  return (
    <SettingsSectionPage section="schedule">
      {({ tournament, tournamentId, canUpdateTournament }) => (
        <ScheduleForm
          tournament={tournament}
          tournamentId={tournamentId}
          disabled={!canUpdateTournament}
        />
      )}
    </SettingsSectionPage>
  );
}

function ScheduleForm({
  tournament,
  tournamentId,
  disabled
}: Readonly<{ tournament: Tournament; tournamentId: number; disabled: boolean }>) {
  const tStatus = useTranslations("common.statusBadge");
  const t = useTranslations("adminTournament.schedule");
  const { form, patch, dirty, summary, saving, save, discard, timezone } =
    useTournamentSettingsForm(tournament, tournamentId, "schedule");

  const setPhaseField = (
    phase: SchedulablePhase,
    field: "starts_at" | "ends_at",
    nextValue: string
  ) =>
    patch({
      phase_schedule: {
        ...form.phase_schedule,
        [phase]: { ...form.phase_schedule[phase], [field]: nextValue }
      }
    });

  const visiblePhases = SCHEDULABLE_PHASES.filter(
    (phase) => phase !== "draft" || form.team_formation === "draft"
  );

  return (
    <>
      <Card>
        <CardContent className="flex flex-col gap-5 pt-6">
          <Field>
            <FieldLabel htmlFor="settings-date-range" className="font-normal text-foreground">
              {t("duration")}
            </FieldLabel>
            <DateRangePicker
              id="settings-date-range"
              startDate={form.start_date}
              endDate={form.end_date}
              onChange={(start, end) => patch({ start_date: start, end_date: end })}
            />
          </Field>

          <section className="flex flex-col gap-4 border-t border-border pt-4">
            <div>
              <h2 className={EYEBROW_CLASS}>{t("title")}</h2>
              <p className="mt-1 text-xs text-muted-foreground">
                {t("hint")}
              </p>
              <p className="mt-1 text-xs font-medium text-foreground/80">
                {t("timezoneLabel", { label: t("timezone"), timezone, offset: getUtcOffsetLabel(timezone) })}
              </p>
            </div>

            {/* One header row instead of four repeated label pairs. Stacked
                below lg, where each picker shows its own labels again. */}
            <div
              role="group"
              aria-label={t("aria")}
              className="flex flex-col gap-4 lg:grid lg:grid-cols-[minmax(6rem,8rem)_1fr_1fr] lg:items-center lg:gap-x-4 lg:gap-y-3"
            >
              <div aria-hidden className="hidden lg:contents">
                <span />
                <span className={EYEBROW_CLASS}>{t("starts")}</span>
                <span className={EYEBROW_CLASS}>{t("ends")}</span>
              </div>

              {visiblePhases.map((phase) => (
                <div key={phase} className="flex flex-col gap-2 lg:contents">
                  <p className="text-xs font-medium text-foreground lg:py-1">
                    {tStatus(phase)}
                  </p>
                  <DateTimePicker
                    id={`settings-phase-${phase}-starts`}
                    timeId={`settings-phase-${phase}-starts-time`}
                    dateLabel={`${tStatus(phase)} starts at`}
                    timeLabel={`${tStatus(phase)} start time`}
                    labelClassName="lg:sr-only"
                    value={form.phase_schedule[phase].starts_at}
                    onChange={(next) => setPhaseField(phase, "starts_at", next)}
                  />
                  <DateTimePicker
                    id={`settings-phase-${phase}-ends`}
                    timeId={`settings-phase-${phase}-ends-time`}
                    dateLabel={`${tStatus(phase)} ends at (optional)`}
                    timeLabel={`${tStatus(phase)} end time`}
                    labelClassName="lg:sr-only"
                    value={form.phase_schedule[phase].ends_at}
                    onChange={(next) => setPhaseField(phase, "ends_at", next)}
                  />
                </div>
              ))}
            </div>
          </section>

          <div className="flex flex-col gap-4 border-t border-border pt-5">
            <div className="flex items-center justify-between gap-4">
              <div className="flex flex-col gap-0.5">
                <Label htmlFor="settings-auto-transitions" className="cursor-pointer">
                  {t("automatic")}
                </Label>
                <p className="text-xs text-muted-foreground">
                  {t("automaticHint")}
                </p>
              </div>
              <Switch
                id="settings-auto-transitions"
                checked={form.auto_transitions_enabled}
                disabled={disabled}
                onCheckedChange={(checked) => patch({ auto_transitions_enabled: checked })}
              />
            </div>

            <div className="flex items-center justify-between gap-4 border-t border-border pt-4">
              <div className="flex flex-col gap-0.5">
                <Label htmlFor="settings-allow-late-registration" className="cursor-pointer">
                  {t("late")}
                </Label>
                <p className="text-xs text-muted-foreground">
                  {t("lateHint")}
                </p>
                {!form.phase_schedule.registration.ends_at && (
                  <p className="text-xs text-warning">
                    {t("noEnd")}
                  </p>
                )}
              </div>
              <Switch
                id="settings-allow-late-registration"
                checked={form.allow_late_registration}
                disabled={disabled}
                onCheckedChange={(checked) => patch({ allow_late_registration: checked })}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      <SaveBar dirty={dirty} summary={summary} saving={saving} onDiscard={discard} onSave={save} />
    </>
  );
}
