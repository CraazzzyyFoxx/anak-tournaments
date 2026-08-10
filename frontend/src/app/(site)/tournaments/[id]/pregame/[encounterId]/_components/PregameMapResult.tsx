"use client";

import { useState } from "react";
import { AlertTriangle, CheckCircle2, Hourglass } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { MapReportDialog } from "@/components/pick-ban/MapReportDialog";
import type { PickBanMapReport } from "@/types/tournament.types";

interface PregameMapResultProps {
  encounterId: number;
  /** The map awaiting its result — picked by the veto, not yet reconciled. */
  mapId: number;
  mapName: string;
  /** Which map of the series this is, 1-based. */
  round: number;
  /** Null for a spectator: they watch the step, they never file a report. */
  viewerSide: "home" | "away" | null;
  homeName: string;
  awayName: string;
  /** Every report filed for THIS map (both sides), from the map pick-ban state. */
  reports: PickBanMapReport[];
  header: React.ReactNode;
  /** Query keys to invalidate once a report lands. */
  invalidateKeys: unknown[][];
}

/**
 * The loop's third phase: the map is picked, its heroes are banned, so the map
 * is played — and BOTH captains confirming its score is what opens the next
 * map's bans (backend: `map_report.submit_map_report` ->
 * `pick_ban_session.advance_to_next_round`).
 *
 * The opponent's numbers stay hidden until both reports are in: the two are
 * meant to be independent claims that reconcile, and showing one first would
 * turn the second into a copy of it. Once both are in and they disagree, both
 * are shown — there is nothing left to bias, and an admin resolves it.
 */
export function PregameMapResult({
  encounterId,
  mapId,
  mapName,
  round,
  viewerSide,
  homeName,
  awayName,
  reports,
  header,
  invalidateKeys,
}: PregameMapResultProps) {
  const t = useTranslations("pickBan.room");
  const [dialogOpen, setDialogOpen] = useState(false);

  const homeReport = reports.find((report) => report.side === "home") ?? null;
  const awayReport = reports.find((report) => report.side === "away") ?? null;
  const ownReport = viewerSide === "home" ? homeReport : viewerSide === "away" ? awayReport : null;
  const bothFiled = homeReport != null && awayReport != null;
  const disputed =
    bothFiled &&
    (homeReport.home_score !== awayReport.home_score || homeReport.away_score !== awayReport.away_score);

  const filedLine = (name: string, report: PickBanMapReport | null) => {
    if (report == null) {
      return (
        <li key={name} className="flex items-center gap-2 text-sm text-[color:var(--aqt-fg-muted)]">
          <Hourglass className="h-4 w-4" aria-hidden />
          {t("mapResult.pending", { team: name })}
        </li>
      );
    }
    return (
      <li key={name} className="flex items-center gap-2 text-sm">
        <CheckCircle2 className="h-4 w-4 text-[color:var(--aqt-teal)]" aria-hidden />
        {bothFiled
          ? t("mapResult.filedScore", { team: name, home: report.home_score, away: report.away_score })
          : t("mapResult.filed", { team: name })}
      </li>
    );
  };

  return (
    <>
      <Card>
        <CardContent className="flex flex-col gap-5 p-5">
          {header}

          <section className="flex flex-col gap-3 rounded-xl border border-[color:var(--aqt-border)] p-4">
            <div className="flex flex-col gap-1">
              <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-[color:var(--aqt-fg-faint)]">
                {t("round.label", { n: round })}
              </span>
              <h2 className="font-onest text-lg font-semibold">{t("mapResult.title", { map: mapName })}</h2>
              <p className="text-sm leading-relaxed text-[color:var(--aqt-fg-muted)]">{t("mapResult.hint")}</p>
            </div>

            <ul className="flex flex-col gap-1.5">
              {filedLine(homeName, homeReport)}
              {filedLine(awayName, awayReport)}
            </ul>

            {disputed ? (
              <p className="flex items-start gap-2 text-sm text-[color:var(--aqt-amber)]">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                {t("mapReport.disputedHint")}
              </p>
            ) : null}

            {viewerSide != null ? (
              <div>
                <Button onClick={() => setDialogOpen(true)}>
                  {ownReport == null ? t("mapResult.report") : t("mapResult.amend")}
                </Button>
              </div>
            ) : null}
          </section>
        </CardContent>
      </Card>

      {viewerSide != null && dialogOpen ? (
        <MapReportDialog
          encounterId={encounterId}
          mapId={mapId}
          mapName={mapName}
          side={viewerSide}
          filed={ownReport}
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          invalidateKeys={invalidateKeys}
        />
      ) : null}
    </>
  );
}
