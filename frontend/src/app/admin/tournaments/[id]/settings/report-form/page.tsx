"use client";

import { useTranslations } from "next-intl";

import dynamic from "next/dynamic";

import { tabFallback } from "../../hubQueries";
import { SettingsSectionPage } from "../SettingsSection";

const MatchReportFormBuilder = dynamic(
  () =>
    import("@/components/admin/matches/MatchReportFormBuilder").then((module) => ({
      default: module.MatchReportFormBuilder
    })),
  { loading: () => tabFallback }
);

/**
 * The captain-facing report form. It used to be the last sub-tab of Play &
 * Results, where it was configuration filed under a results browser.
 */
export default function ReportFormSettingsPage() {
  return (
    <SettingsSectionPage
      section="report-form"
      description={useTranslations("adminTournament.screenDescriptions")("reportForm")}
    >
      {({ tournamentId }) => <MatchReportFormBuilder tournamentId={tournamentId} />}
    </SettingsSectionPage>
  );
}
