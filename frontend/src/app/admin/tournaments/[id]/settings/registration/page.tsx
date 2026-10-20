"use client";

import { useId } from "react";
import dynamic from "next/dynamic";
import { useTranslations } from "next-intl";

import { SaveBar } from "@/components/kit/SaveBar";
import { SettingGroup, SettingRow } from "@/components/kit/SettingRow";
import { StatusPill } from "@/components/kit/StatusPill";
import { EYEBROW_CLASS } from "@/components/kit/tone";
import { NumberInput } from "@/components/ui/number-input";
import { Switch } from "@/components/ui/switch";
import { PageStateCard } from "@/components/ui/page-state-card";
import { tabFallback } from "../../hubQueries";
import { SettingsSectionPage } from "../SettingsSection";
import { useRegistrationFormSection } from "../useRegistrationFormSection";

const RegistrationFormBuilder = dynamic(
  () => import("@/components/balancer/form/RegistrationFormBuilder"),
  { loading: () => tabFallback }
);

/**
 * How entries are taken, what the public sees of them, and the questionnaire
 * itself. The builder used to be a Registration sub-tab of its own; it is
 * configuration, so it lives here (`registration/form` redirects to this page).
 *
 * Two editors, two save bars: both write the same full-replace form, and each
 * echoes the other's saved fields. Each bar is sticky only inside its own
 * block, so the two never stack.
 */
export default function RegistrationSettingsPage() {
  const t = useTranslations("registrationFormAdmin.page");
  return (
    <SettingsSectionPage section="registration">
      {({ tournament, tournamentId, canTeamCreate }) => (
        <>
          <div>
            <RegistrationForm tournamentId={tournamentId} disabled={!canTeamCreate} />
          </div>
          <section className="flex flex-col gap-3">
            <h2 className={EYEBROW_CLASS}>{t("questionnaire.title")}</h2>
            <RegistrationFormBuilder
              tournamentId={tournamentId}
              identityProvider={tournament.identity_provider}
            />
          </section>
        </>
      )}
    </SettingsSectionPage>
  );
}

function RegistrationForm({
  tournamentId,
  disabled
}: Readonly<{ tournamentId: number; disabled: boolean }>) {
  const t = useTranslations("registrationFormAdmin.page");
  const tStatus = useTranslations("registrationFormAdmin.status");
  const ids = useId();
  const { value, saved, patch, dirty, summary, saving, save, discard, error, retry } =
    useRegistrationFormSection(tournamentId);

  if (!value) {
    return error ? (
      <PageStateCard
        state="error"
        title={t("loadError.title")}
        description={error.message}
        onAction={retry}
      />
    ) : (
      tabFallback
    );
  }

  return (
    <>
      <div className="flex flex-col gap-4">
        <SettingGroup title={tStatus("title")}>
          {/* Derived, not editable: openness is the REGISTRATION phase-schedule
                window. Shown because this is the screen an organizer opens to ask
                "are we taking entries", and the answer lives one section away.
                Closed is the absence of the pill. */}
          <SettingRow label={tStatus("acceptLabel")} hint={tStatus("scheduleHint")}>
            {saved?.is_open ? <StatusPill tone="success">{tStatus("stateOpen")}</StatusPill> : null}
          </SettingRow>
          <SettingRow
            htmlFor={`${ids}-auto-approve`}
            label={tStatus("autoApproveLabel")}
            hint={tStatus("autoApproveHint")}
          >
            <Switch
              id={`${ids}-auto-approve`}
              checked={value.auto_approve}
              disabled={disabled}
              onCheckedChange={(next) => patch({ auto_approve: next })}
            />
          </SettingRow>
        </SettingGroup>

        <SettingGroup title={t("display.title")} description={t("display.description")}>
          <SettingRow
            htmlFor={`${ids}-max-participants`}
            label={t("display.maxParticipants")}
            hint={t("display.maxParticipantsHint")}
          >
            <NumberInput
              id={`${ids}-max-participants`}
              integer
              min={0}
              value={value.max_participants ?? null}
              disabled={disabled}
              onValueChange={(next) => patch({ max_participants: next })}
              size="sm"
              className="w-24"
            />
          </SettingRow>
          <SettingRow
            htmlFor={`${ids}-hide-registrations`}
            label={t("display.hideRegistrations")}
            hint={t("display.hideRegistrationsHint")}
          >
            <Switch
              id={`${ids}-hide-registrations`}
              checked={value.hide_registrations ?? false}
              disabled={disabled}
              onCheckedChange={(next) => patch({ hide_registrations: next })}
            />
          </SettingRow>
          <SettingRow
            htmlFor={`${ids}-show-ranks`}
            label={t("display.showRanks")}
            hint={t("display.hint")}
          >
            <Switch
              id={`${ids}-show-ranks`}
              checked={value.show_ranks ?? false}
              disabled={disabled}
              onCheckedChange={(next) => patch({ show_ranks: next })}
            />
          </SettingRow>
        </SettingGroup>
      </div>

      <SaveBar
        dirty={dirty}
        summary={summary}
        saving={saving}
        onDiscard={discard}
        onSave={save}
      />
    </>
  );
}
