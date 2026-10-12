"use client";

import { AlertTriangle, Check, Minus } from "lucide-react";
import { useTranslations } from "next-intl";

import { TONE_CLASS, TONE_TEXT } from "@/components/kit/tone";
import { cn } from "@/lib/utils";
import type { AdminCaptainReport } from "@/types/admin.types";

interface AdminReportPairCellProps {
  homeReport: AdminCaptainReport | null;
  awayReport: AdminCaptainReport | null;
  /** `null` = fewer than two reports, so agreement is not yet knowable. */
  scoresMatch: boolean | null;
  /** False when a reported score cannot happen in this encounter's best-of. */
  seriesScoreValid: boolean;
  className?: string;
}

function ReportSide({ label, report, t }: Readonly<{ label: string; report: AdminCaptainReport | null; t: (key: "unknown" | "noRating" | "noReport") => string }>) {
  return (
    <div className="min-w-0">
      <p className="text-xs font-bold uppercase tracking-[0.15em] text-muted-foreground">
        {label}
      </p>
      {report ? (
        <>
          <p className="font-mono text-sm font-semibold tabular-nums">
            {report.home_score} &ndash; {report.away_score}
          </p>
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
 * The two captains' reports for one encounter, side by side.
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
  homeReport,
  awayReport,
  scoresMatch,
  seriesScoreValid,
  className
}: Readonly<AdminReportPairCellProps>) {
  const t = useTranslations("adminMatches.common");
  const reportsT = useTranslations("adminMatches.reports");
  const verdict =
    scoresMatch === null
      ? { tone: "neutral" as const, icon: Minus, label: reportsT("awaitingSecond") }
      : scoresMatch
        ? { tone: "success" as const, icon: Check, label: reportsT("reportsAgree") }
        : { tone: "danger" as const, icon: AlertTriangle, label: reportsT("reportsDisagree") };
  const VerdictIcon = verdict.icon;

  return (
    <div className={cn("space-y-2", className)}>
      <div className="grid grid-cols-2 gap-3">
        <ReportSide label={reportsT("home")} report={homeReport} t={t} />
        <ReportSide label={reportsT("away")} report={awayReport} t={t} />
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
