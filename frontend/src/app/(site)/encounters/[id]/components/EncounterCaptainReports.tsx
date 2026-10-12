"use client";

import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useFormatter } from "@/lib/datetime/client";
import { TriangleAlert } from "lucide-react";

import { cn } from "@/lib/utils";
import captainService from "@/services/captain.service";
import type {
  CaptainReport,
  Encounter,
  EncounterTeam,
  MatchReportForm,
  ReplayCode
} from "@/types/encounter.types";
import { duelSeats, type DuelSlot } from "@/lib/encounter/seats";
import styles from "@/components/match/EncounterDetail.module.css";
import { encounterQueryKeys } from "@/lib/encounters/query-keys";

interface EncounterCaptainReportsProps {
  encounterId: number;
  teams: Encounter["teams"];
}

/** The score a report gave one seat; null when the report has no line for it. */
function reportedScore(report: CaptainReport, seat: EncounterTeam | null): number | null {
  return report.results.find((line) => line.encounter_team_id === seat?.id)?.score ?? null;
}

/**
 * What the captains actually filed.
 *
 * This is a public (`AuthOptional`) endpoint the detail page never called, so
 * the provenance of a series score — who reported it, what quality they rated
 * the match, which lobby codes were used, and any organizer-defined answers —
 * was invisible outside the admin tools. Renders nothing when no report exists.
 */
export default function EncounterCaptainReports({
  encounterId,
  teams
}: Readonly<EncounterCaptainReportsProps>) {
  const t = useTranslations();
  const reportsQuery = useQuery({
    queryKey: encounterQueryKeys.reports(encounterId),
    queryFn: () => captainService.getReports(encounterId),
    retry: false,
    staleTime: 60_000
  });

  const reports = reportsQuery.data?.reports ?? [];
  if (reports.length === 0) return null;

  const [seatOne, seatTwo] = duelSeats(teams);
  const disagree =
    reports.length > 1 &&
    reports.some(
      (report) =>
        reportedScore(report, seatOne) !== reportedScore(reports[0], seatOne) ||
        reportedScore(report, seatTwo) !== reportedScore(reports[0], seatTwo)
    );

  const seatOf = (report: CaptainReport): EncounterTeam | null =>
    teams.find((seat) => seat.id === report.encounter_team_id) ?? null;
  const seatNameOf = (report: CaptainReport): string => seatOf(report)?.name ?? t("common.unknown");

  return (
    // Own the section: an encounter whose captains never filed anything renders
    // nothing at all, and a heading over emptiness is worse than no heading.
    <section aria-label={t("encounters.detail.reports")}>
      <div className={styles.sectionHead}>
        <h2 className={styles.sectionTitle}>{t("encounters.detail.reports")}</h2>
        <span className={styles.sectionMeta}>
          {t("encounters.detail.reportsMeta", { count: reports.length })}
        </span>
      </div>
      <div className={styles.statsStack}>
        {disagree ? (
          <output className={styles.reportMismatch}>
            <TriangleAlert aria-hidden width={15} height={15} className="mt-px shrink-0" />
            {t("encounters.detail.reportsDisagree")}
          </output>
        ) : null}
        <div className={styles.reportGrid}>
          {reports.map((report) => (
            <ReportCard
              key={report.id}
              report={report}
              teamName={seatNameOf(report)}
              slot={seatOf(report)?.slot === 2 ? 2 : 1}
              seatOne={seatOne}
              seatTwo={seatTwo}
              form={reportsQuery.data?.form}
              replayCodes={(reportsQuery.data?.replay_codes ?? []).filter(
                (code) => code.encounter_team_id === report.encounter_team_id
              )}
            />
          ))}
        </div>
      </div>
    </section>
  );
}

function ReportCard({
  report,
  teamName,
  slot,
  seatOne,
  seatTwo,
  form,
  replayCodes
}: Readonly<{
  report: CaptainReport;
  teamName: string;
  slot: DuelSlot;
  seatOne: EncounterTeam | null;
  seatTwo: EncounterTeam | null;
  form?: MatchReportForm;
  /** This participation's codes by position (`game_team.replay_code`). */
  replayCodes: ReplayCode[];
}>) {
  const t = useTranslations();
  const format = useFormatter();
  const submittedAt = report.updated_at ?? report.created_at;
  const customFields = form?.custom_fields ?? [];

  return (
    <div className={cn(styles.card, slot === 2 ? styles.slotTwo : styles.slotOne)}>
      <div className={styles.rosterHead}>
        <h3 className={styles.rosterName}>{teamName}</h3>
        <span className={styles.cardSub}>
          {[
            report.reporter_name,
            submittedAt
              ? format.dateTime(new Date(submittedAt), {
                  day: "numeric",
                  month: "short",
                  hour: "2-digit",
                  minute: "2-digit"
                })
              : null
          ]
            .filter(Boolean)
            .join(" · ")}
        </span>
      </div>

      <div className={cn(styles.cardBody, styles.reportFields)}>
        <div className={styles.reportField}>
          <span className={styles.label}>{t("encounters.detail.reportedScore")}</span>
          <span className={styles.reportScore}>
            <span className={styles.scoreOne}>{reportedScore(report, seatOne)}</span>
            <span aria-hidden className={styles.scoreSep}>
              :
            </span>
            <span className={styles.scoreTwo}>{reportedScore(report, seatTwo)}</span>
          </span>
        </div>

        {report.closeness != null ? (
          <div className={styles.reportField}>
            <span className={styles.label}>{t("encounters.detail.reportedCloseness")}</span>
            <span className={cn(styles.reportValue, styles.mono)}>
              {t("encounters.detail.reportedClosenessValue", { value: report.closeness })}
            </span>
          </div>
        ) : null}

        {replayCodes.length > 0 ? (
          <div className={styles.reportField}>
            <span className={styles.label}>{t("encounters.detail.reportedCodes")}</span>
            <span className={styles.reportCodes}>
              {[...replayCodes]
                .sort((a, b) => a.position - b.position)
                .map(({ position, code }) => (
                  <span key={position} className={styles.reportCode}>
                    {t("common.matchLogs.map", { index: position })} · {code}
                  </span>
                ))}
            </span>
          </div>
        ) : null}

        {report.comment ? (
          <div className={styles.reportField}>
            <span className={styles.label}>{t("encounters.detail.reportedComment")}</span>
            <p className={styles.reportValue}>{report.comment}</p>
          </div>
        ) : null}

        {customFields.map((definition) => {
          const value = report.custom_fields?.[definition.key];
          if (!value) return null;
          return (
            <div key={definition.key} className={styles.reportField}>
              <span className={styles.label}>{definition.label}</span>
              <p className={styles.reportValue}>{value}</p>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export type { EncounterCaptainReportsProps };
