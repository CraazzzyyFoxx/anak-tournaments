"use client";

import { AlertTriangle, Check, Minus } from "lucide-react";
import { useTranslations } from "next-intl";

import { TONE_CLASS, TONE_TEXT } from "@/components/kit/tone";
import { reportOf, scoreline } from "@/lib/encounter/reports";
import { seatsBySlot } from "@/lib/encounter/seats";
import { cn } from "@/lib/utils";
import type { AdminCaptainReport, EncounterParticipationRef } from "@/types/admin.types";

interface AdminReportPairCellProps {
  /** The encounter's live seats; their slot order is the order everything below reads in. */
  participations: EncounterParticipationRef[];
  reports: AdminCaptainReport[];
  /** `null` = not every participation has reported, so agreement is not yet knowable. */
  standingsMatch: boolean | null;
  /** False when a reported standing cannot happen in this encounter's best-of. */
  seriesScoreValid: boolean;
  className?: string;
}

function ReportSeat({
  label,
  report,
  standing,
  t
}: Readonly<{
  label: string;
  report: AdminCaptainReport | null;
  standing: string;
  t: (key: "unknown" | "noRating" | "noReport") => string;
}>) {
  return (
    <div className="min-w-0">
      <p className="truncate text-xs font-bold uppercase tracking-[0.15em] text-muted-foreground">
        {label}
      </p>
      {report ? (
        <>
          <p className="font-mono text-sm font-semibold tabular-nums">{standing}</p>
          <p className="truncate text-xs text-muted-foreground">
            {report.reporter_name ?? t("unknown")} &middot;{" "}
            {/* Match quality is configurable per tournament, so an absent rating
                is a legitimate report — not a missing number to render as NaN. */}
            {report.closeness == null ? t("noRating") : `${report.closeness}/10`}
          </p>
          {report.comment ? (
            // Clamped rather than hidden: an organizer settling a dispute needs
            // to read what the captain wrote, and `title` carries the rest.
            <p
              className="mt-0.5 line-clamp-2 text-xs italic text-muted-foreground"
              title={report.comment}
            >
              &ldquo;{report.comment}&rdquo;
            </p>
          ) : null}
        </>
      ) : (
        <p className="flex items-center gap-1 text-xs italic text-muted-foreground">
          <Minus className="size-3" aria-hidden />
          {t("noReport")}
        </p>
      )}
    </div>
  );
}

/**
 * Every participation's report for one encounter, side by side in slot order.
 *
 * Agreement is three-valued and rendered as three distinct things, not two: an
 * encounter waiting on a second captain is not in conflict, and showing it as
 * one would send an admin to adjudicate a dispute that does not exist.
 *
 * Every state carries an icon and a word — never colour alone (design book,
 * accessibility floor), so the table still reads under greyscale, in high
 * contrast, and to a screen reader.
 */
export function AdminReportPairCell({
  participations,
  reports,
  standingsMatch,
  seriesScoreValid,
  className
}: Readonly<AdminReportPairCellProps>) {
  const t = useTranslations("adminMatches.common");
  const reportsT = useTranslations("adminMatches.reports");
  const seats = seatsBySlot(participations);
  const seatIds = seats.map((seat) => seat.encounter_team_id);
  const verdict =
    standingsMatch === null
      ? { tone: "neutral" as const, icon: Minus, label: reportsT("awaitingRemaining") }
      : standingsMatch
        ? { tone: "success" as const, icon: Check, label: reportsT("reportsAgree") }
        : { tone: "danger" as const, icon: AlertTriangle, label: reportsT("reportsDisagree") };
  const VerdictIcon = verdict.icon;

  return (
    <div className={cn("space-y-2", className)}>
      <div className="grid grid-cols-2 gap-3">
        {seats.map((seat) => {
          const report = reportOf(reports, seat.encounter_team_id);
          return (
            <ReportSeat
              key={seat.encounter_team_id}
              label={seat.name}
              report={report}
              standing={report ? scoreline(report.results, seatIds) : ""}
              t={t}
            />
          );
        })}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={cn(
            "inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-xs",
            TONE_CLASS[verdict.tone]
          )}
        >
          <VerdictIcon className="size-3" aria-hidden />
          {verdict.label}
        </span>
        {!seriesScoreValid ? (
          <span
            className={cn("inline-flex items-center gap-1 text-xs", TONE_TEXT.warning)}
            // Advisory, not an error: reports predate per-round best-of, so this
            // flags something worth a look rather than something that is wrong.
            title={reportsT("outsideBoTitle")}
          >
            <AlertTriangle className="size-3" aria-hidden />
            {t("scoreOutside")}
          </span>
        ) : null}
      </div>
    </div>
  );
}
