"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { MatchReportForm, matchReportDraftKey } from "@/components/tournaments/MatchReportForm";
import { PickBanItemThumb } from "@/components/pick-ban/PickBanItemThumb";
import type { Encounter } from "@/types/encounter.types";

import { PregameHeroBans, type PregameHeroRound } from "./PregameHeroBans";

interface PregameFinalReportProps {
  encounter: Encounter;
  /** Null for anyone who captains neither side: the report is per-team. */
  viewerSide: "home" | "away" | null;
  /**
   * Whether a series report exists to be filed at all. False for a scrim room:
   * it publishes no result, and the form is built from a per-tournament config
   * the scrims container does not have. Behaves like the settled state a
   * spectator already sees, with its own closing line — "the result is with the
   * organizers now" would name a role a scrim has nobody in.
   */
  reportable?: boolean;
  /**
   * One line naming who won the series, shown only when there is no report to
   * file. Built by the room, which already has both team names and the
   * encounter's running score — the closing screen would otherwise end a
   * finished series without saying how it ended.
   */
  outcome?: string | null;
  /**
   * Every map's hero bans, in play order — the series' own record, kept on the
   * screen that closes it. Nothing else here names what the maps were played
   * under, and a captain filing the report (or an organizer reading a dispute)
   * would otherwise have to reopen a grid that is already complete.
   */
  heroRounds?: PregameHeroRound[];
  /** Side names for the hero blocks, resolved by the room (it owns the fallbacks). */
  homeName?: string;
  awayName?: string;
  header: ReactNode;
  /** Where the room hands the viewer back — the page they opened it from. */
  returnTo: string;
}

/**
 * The loop's last step: nothing is left to pick or ban — with a map veto that
 * means every map has been played and reconciled — so what remains is the
 * SERIES report. That is the one carrying the match codes, the closeness rating
 * and whatever custom fields the organizer configured.
 *
 * This used to be a dead end ("nothing left to decide") that sent captains back
 * to the encounter page to hunt for the report dialog. The form is the same one
 * (`MatchReportForm`), mounted here instead, arriving prefilled: every map the
 * room just collected a result for is counted into the encounter's score
 * (backend `map_report.submit_map_report`) and named in the code slots.
 *
 * Filing it returns the viewer to `returnTo` rather than the encounter page —
 * mid-tournament the room is opened from the bracket, and that is where the
 * next match is picked.
 */
export function PregameFinalReport({
  encounter,
  viewerSide,
  reportable = true,
  outcome = null,
  heroRounds = [],
  homeName,
  awayName,
  header,
  returnTo
}: Readonly<PregameFinalReportProps>) {
  const t = useTranslations("pickBan.room");
  const router = useRouter();

  const confirmed = encounter.result_status === "confirmed";
  // Nothing for a spectator (or an admin who captains neither side) to file, and
  // nothing to file once the organizers have confirmed the result: for them the
  // series really is settled and the old copy is the honest answer.
  const settled = confirmed || viewerSide == null || !reportable;

  const back = (
    <Button variant="outline" asChild className="h-10 px-5 font-semibold">
      <Link href={returnTo}>
        <ArrowLeft className="mr-2 h-4 w-4" aria-hidden />
        {t("back")}
      </Link>
    </Button>
  );

  return (
    <Card>
      <CardContent className="flex flex-col gap-5 p-5">
        {header}
        <section className="flex flex-col gap-2 rounded-xl border border-[color:var(--aqt-border)] p-4">
          <h2 className="font-onest text-lg font-semibold">
            {settled ? t("seriesDone.title") : t("finalReport.title")}
          </h2>
          {settled && !reportable && outcome ? (
            <p className="font-onest text-base font-semibold">{outcome}</p>
          ) : null}
          <p className="text-sm leading-relaxed text-[color:var(--aqt-fg-muted)]">
            {!settled
              ? t("finalReport.hint")
              : reportable
                ? t("seriesDone.hint")
                : t("seriesDone.hintNoReport")}
          </p>
          {settled ? (
            <div className="mt-1">{back}</div>
          ) : (
            <MatchReportForm
              key={matchReportDraftKey(encounter)}
              encounter={encounter}
              onSubmitted={() => router.push(returnTo)}
              cancelAction={back}
              fieldsClassName="mt-2"
            />
          )}
        </section>

        {/* Below the report, not above it: the report is what the captain came
            to file, and a Bo5's worth of ban blocks between the header and the
            form would push it off the first screen. Here it reads as what it
            is — the series' record, once the deciding is over. */}
        {heroRounds.length > 0 ? (
          <section
            data-hero-record
            className="flex flex-col gap-3 rounded-xl border border-[color:var(--aqt-border)] p-4"
          >
            <h2 className="font-onest text-lg font-semibold">{t("heroBans.seriesTitle")}</h2>
            {/* One ROW per map, its still anchoring the left: side by side the
                four team cards of two maps read as one row of four teams, and
                the map each pair belonged to got lost. A rule between rows and
                a fixed caption column make the series read down the page the
                way it was played. */}
            <ol className="flex flex-col divide-y divide-[color:var(--aqt-border)]">
              {heroRounds.map((block) => (
                <li
                  key={block.round ?? "series"}
                  className="grid gap-3 py-4 first:pt-1 last:pb-1 lg:grid-cols-[11rem_minmax(0,1fr)] lg:gap-6"
                >
                  {block.round == null || block.mapName == null ? (
                    <span className="font-mono text-[11px] font-bold uppercase tracking-[0.16em] text-[color:var(--aqt-rose)]">
                      {t("heroBans.seriesEyebrow")}
                    </span>
                  ) : (
                    // The map's own still, not just its name: the header's
                    // filmstrip identifies each map by art, and a text-only
                    // caption made the reader match names back up to it.
                    <div className="flex items-center gap-3 lg:flex-col lg:items-start lg:gap-2">
                      <PickBanItemThumb
                        kind="map"
                        item={block.mapItem}
                        name={block.mapName}
                        size={60}
                      />
                      <div className="flex min-w-0 flex-col">
                        <span className="font-mono text-[11px] font-bold uppercase tracking-[0.16em] text-[color:var(--aqt-fg-faint)]">
                          {t("round.label", { n: block.round })}
                        </span>
                        <span
                          title={block.mapName}
                          className="truncate font-onest text-sm font-semibold"
                        >
                          {block.mapName}
                        </span>
                      </div>
                    </div>
                  )}
                  <PregameHeroBans
                    actions={block.actions}
                    homeName={homeName ?? t("side.home")}
                    awayName={awayName ?? t("side.away")}
                    homeTeam={encounter.home_team ?? null}
                    awayTeam={encounter.away_team ?? null}
                    eyebrow={null}
                    hint={null}
                  />
                </li>
              ))}
            </ol>
          </section>
        ) : null}
      </CardContent>
    </Card>
  );
}
