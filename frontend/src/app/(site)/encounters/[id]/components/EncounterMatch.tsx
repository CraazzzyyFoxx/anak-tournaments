"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import Image from "next/image";
import Link from "next/link";
import { ExternalLink } from "lucide-react";

import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { PageStateCard } from "@/components/ui/page-state-card";
import { Skeleton } from "@/components/ui/skeleton";
import MatchLogIndicator from "@/components/match/MatchLogIndicator";
import MatchStatsSection from "@/app/(site)/matches/[id]/components/MatchStatsSection";
import encounterService from "@/services/encounter.service";
import { Match } from "@/types/encounter.types";
import type { DivisionGridVersion } from "@/types/workspace.types";

/**
 * A map card that opens the full scoreboard.
 *
 * The stats used to be fetched and fully rendered on the server for every map of
 * the series, inside a Dialog that starts closed — so a Bo5 issued five
 * sequential requests and shipped five complete stat tables in the initial HTML
 * for content nobody had opened. The detail is now loaded when the dialog opens.
 */
const EncounterMatch = ({
  match,
  tournamentGrid
}: {
  match: Match;
  tournamentGrid?: DivisionGridVersion | null;
}) => {
  const t = useTranslations();
  const [open, setOpen] = useState(false);

  const matchQuery = useQuery({
    queryKey: ["match-detail", match.id],
    queryFn: () => encounterService.getMatch(match.id),
    enabled: open,
    staleTime: 5 * 60_000
  });

  const data = matchQuery.data;
  const mapName = match.map?.name ?? "";

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        className="rounded-[var(--aqt-radius)] outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--aqt-teal)] focus-visible:ring-offset-2 focus-visible:ring-offset-[color:var(--aqt-bg)]"
        aria-label={t("encounters.match.openStats", { map: mapName })}
      >
        <Card className="relative h-[115px] max-w-[230px] overflow-hidden">
          {match.map ? <Image src={match.map.image_path} alt="" fill /> : null}
          <h4 className="absolute bottom-0 left-0 m-2 p-1 text-xl font-semibold tracking-tight text-[color:var(--aqt-fg)]">
            {mapName}
          </h4>
        </Card>
      </DialogTrigger>
      <DialogContent className="flex max-h-[90vh] w-[95vw] max-w-[1100px] flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="shrink-0 space-y-0 border-b border-[color:var(--aqt-border)] bg-[color:var(--aqt-card)] p-4 pr-14">
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
            <div className="flex items-center gap-2.5">
              {data?.map?.gamemode ? (
                <Image
                  src={data.map.gamemode.image_path}
                  alt={data.map.gamemode.name || t("encounters.match.gamemodeAlt")}
                  height={32}
                  width={32}
                />
              ) : null}
              <DialogTitle className="text-lg font-semibold tracking-tight">{mapName}</DialogTitle>
            </div>
            {data ? (
              <div className="flex items-center gap-2">
                <span className="max-w-[160px] truncate text-sm font-semibold text-[color:var(--aqt-teal)]">
                  {data.home_team.name}
                </span>
                <span className="aqt-tnum text-xl font-bold text-[color:var(--aqt-teal)]">
                  {data.score.home}
                </span>
                <span className="text-[color:var(--aqt-fg-dim)]">:</span>
                <span className="aqt-tnum text-xl font-bold text-[color:var(--aqt-rose)]">
                  {data.score.away}
                </span>
                <span className="max-w-[160px] truncate text-sm font-semibold text-[color:var(--aqt-rose)]">
                  {data.away_team.name}
                </span>
              </div>
            ) : (
              <Skeleton className="h-6 w-56" />
            )}
            <div className="ml-auto flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-[color:var(--aqt-fg-muted)]">
              <span className="inline-flex items-center gap-1.5">
                <span className="text-[color:var(--aqt-fg-faint)]">
                  {t("encounters.match.playtime")}
                </span>
                <span className="aqt-tnum font-semibold text-[color:var(--aqt-fg)]">
                  {Math.floor(match.time / 60)}m {(match.time % 60).toFixed(0)}s
                </span>
              </span>
              {match.log_name ? (
                <span className="inline-flex items-center gap-1.5">
                  <span className="aqt-tnum">{match.log_name}</span>
                  <MatchLogIndicator
                    hasLogs
                    logs={[{ matchId: match.id, label: match.map?.name ?? undefined }]}
                  />
                </span>
              ) : null}
              <Link
                href={`/matches/${match.id}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 font-semibold text-[color:var(--aqt-teal)] hover:underline"
              >
                <ExternalLink aria-hidden className="h-4 w-4" />
                <span className="hidden sm:inline">{t("encounters.match.openNewTab")}</span>
              </Link>
            </div>
          </div>
        </DialogHeader>
        <div className="flex-1 overflow-y-auto p-4">
          {matchQuery.isError ? (
            <PageStateCard state="error" onAction={() => void matchQuery.refetch()} />
          ) : data ? (
            <MatchStatsSection match={data} tournamentGrid={tournamentGrid} />
          ) : (
            <div className="flex flex-col gap-2">
              {Array.from({ length: 8 }).map((_, index) => (
                <Skeleton key={index} className="h-10 w-full rounded-md" />
              ))}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default EncounterMatch;
