"use client";

import { AdminReportPairCell } from "@/components/admin/AdminReportPairCell";
import { EYEBROW_CLASS, TONE_TEXT } from "@/components/kit/tone";
import { useFormatter } from "@/lib/datetime/client";
import { cn } from "@/lib/utils";
import { useTranslations } from "next-intl";
import type { EncounterReportsRow } from "@/types/admin.types";
import type { ReportCustomFieldDefinition } from "@/types/encounter.types";

import { reportOf, scoreline } from "@/lib/encounter/reports";
import { seatsBySlot } from "@/lib/encounter/seats";

import { ReportDetail } from "./ReportDetail";
import { fmtDate } from "./report-model";

/**
 * One encounter's whole filing, not a summary of it: this is the surface an
 * admin adjudicates from, and a field left out here is a field they would have
 * to go find in the database.
 */
export function ReportInspectorPanel({
  row,
  customFields
}: Readonly<{
  row: EncounterReportsRow;
  customFields: ReportCustomFieldDefinition[];
}>) {
  const format = useFormatter();
  const t = useTranslations("adminMatches.reports");
  const seats = seatsBySlot(row.participations);
  const seatIds = seats.map((seat) => seat.encounter_team_id);

  return (
    <div className="space-y-4">
      <AdminReportPairCell
        participations={row.participations}
        reports={row.reports}
        standingsMatch={row.standings_match}
        seriesScoreValid={row.series_score_valid}
      />

      {seats.map((seat) => {
        const report = reportOf(row.reports, seat.encounter_team_id);
        return (
          <ReportDetail
            key={seat.encounter_team_id}
            label={t("slot", { slot: seat.slot })}
            teamName={seat.name}
            standing={report ? scoreline(report.results, seatIds) : ""}
            report={report}
            replayCodes={row.replay_codes.filter((code) => code.encounter_team_id === seat.encounter_team_id)}
            customFields={customFields}
          />
        );
      })}

      <div className="grid grid-cols-2 gap-3">
        <div className="min-w-0">
          <p className={EYEBROW_CLASS}>{t("recordedTeams")}</p>
          <p className="truncate text-sm">
            {seats.map((seat) => seat.name).join(` ${t("vs")} `)}
          </p>
        </div>
        <div className="min-w-0">
          <p className={EYEBROW_CLASS}>{t("result")}</p>
          <p className="truncate text-sm">{row.result_status}</p>
        </div>
        <div className="min-w-0">
          <p className={EYEBROW_CLASS}>{t("status")}</p>
          <p className="truncate text-sm">{row.status}</p>
        </div>
        <div className="min-w-0">
          <p className={EYEBROW_CLASS}>{t("filed")}</p>
          <p className="truncate text-sm tabular-nums">
            {row.reported_count}/{row.participations.length}
          </p>
        </div>
        <div className="min-w-0">
          <p className={EYEBROW_CLASS}>{t("scheduled")}</p>
          <p className="truncate text-sm tabular-nums">{fmtDate(format, row.scheduled_at)}</p>
        </div>
        <div className="min-w-0">
          <p className={EYEBROW_CLASS}>{t("seriesCheck")}</p>
          <p className={cn("truncate text-sm", !row.series_score_valid && TONE_TEXT.warning)}>
            {row.series_score_valid ? t("withinBo") : t("outsideBo")}
          </p>
        </div>
        <div className="min-w-0">
          <p className={EYEBROW_CLASS}>{t("encounterId")}</p>
          <p className="truncate text-sm tabular-nums">{row.id}</p>
        </div>
        <div className="min-w-0">
          <p className={EYEBROW_CLASS}>{t("tournament")}</p>
          <p className="truncate text-sm">{row.tournament_name ?? `#${row.tournament_id}`}</p>
        </div>
      </div>

      {row.last_resolution ? (
        <section className="rounded-xl border border-border/60 p-3">
          <p className={EYEBROW_CLASS}>{t("lastResolution")}</p>
          <p className="mt-1 text-sm">
            {t("resolutionBy", {
              action: row.last_resolution.action,
              actor: row.last_resolution.actor_name ?? t("automatedProcess")
            })}
          </p>
          <p className="text-xs tabular-nums text-muted-foreground">
            {fmtDate(format, row.last_resolution.created_at)}
          </p>
        </section>
      ) : null}
    </div>
  );
}
