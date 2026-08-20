"use client";

import Link from "next/link";
import { ArrowRight, Calendar } from "lucide-react";

import { Button } from "@/components/ui/button";
import { CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { TONE_CLASS } from "@/components/admin/tone";
import { formatTournamentStages } from "@/lib/tournament-stages";
import { cn } from "@/lib/utils";
import { PermissionHiddenNotice } from "./PermissionHiddenNotice";
import { SurfaceCard, SurfaceCardContent } from "./SurfaceCard";
import { tournamentStatus } from "./tournament-status";
import type { Tournament } from "@/types/tournament.types";

function formatDate(value?: Date | string | null) {
  if (!value) return "-";
  return new Date(value).toLocaleDateString();
}

interface ActiveTournamentCardProps {
  canRead: boolean;
  tournament: Tournament | null;
  encounterCount: number;
  missingLogs: number;
  logCoveragePercent: number;
  canReadMatches: boolean;
}

export function ActiveTournamentCard({
  canRead,
  tournament,
  encounterCount,
  missingLogs,
  logCoveragePercent,
  canReadMatches,
}: Readonly<ActiveTournamentCardProps>) {
  const completedLogs = encounterCount - missingLogs;

  if (!canRead) {
    return (
      <SurfaceCard>
        <SurfaceCardContent className="pt-5">
          <PermissionHiddenNotice
            title="Tournament data is hidden"
            permission="tournament read"
          />
        </SurfaceCardContent>
      </SurfaceCard>
    );
  }

  if (!tournament) {
    return (
      <SurfaceCard>
        <SurfaceCardContent className="pt-5">
          <div className="flex flex-col gap-3">
            <p className="text-sm text-muted-foreground">
              No tournaments are currently active. Create or reopen a tournament to populate the
              dashboard.
            </p>
            <Button asChild variant="outline" size="sm" className="w-fit">
              <Link href="/admin/tournaments">
                View all tournaments
                <ArrowRight className="size-3.5" aria-hidden />
              </Link>
            </Button>
          </div>
        </SurfaceCardContent>
      </SurfaceCard>
    );
  }

  const status = tournamentStatus(tournament.is_finished);
  const stageCount = tournament.stages?.length ?? 0;
  const stageList = stageCount > 0 ? formatTournamentStages(tournament.stages) : null;

  return (
    <SurfaceCard>
      <SurfaceCardContent className="pt-5">
        <div className="flex flex-col gap-4">
          {/* Status + kind */}
          <div className="flex items-center gap-3">
            <span
              className={cn(
                "flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs font-medium",
                TONE_CLASS[status.tone],
              )}
            >
              {!tournament.is_finished && (
                <span className="size-1.5 animate-pulse rounded-full bg-current" aria-hidden />
              )}
              {status.label}
            </span>
            <span className="text-xs text-muted-foreground">
              {tournament.is_league ? "League" : "Tournament"}
            </span>
          </div>

          <CardTitle asChild className="line-clamp-1 text-xl text-foreground">
            <h2>{tournament.name}</h2>
          </CardTitle>

          {/* Dates + stage count — the only place the stage count is stated */}
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Calendar className="size-3.5" aria-hidden />
            <span className="tabular-nums">
              {formatDate(tournament.start_date)} — {formatDate(tournament.end_date)}
            </span>
            {stageCount > 0 && (
              <span className="tabular-nums">
                · {stageCount} stage{stageCount === 1 ? "" : "s"}
              </span>
            )}
          </div>

          {stageList && (
            <div className="truncate text-xs text-muted-foreground" title={stageList}>
              {stageList}
            </div>
          )}

          {canReadMatches && encounterCount > 0 && (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>Log coverage</span>
                <span className="font-medium tabular-nums text-foreground">
                  {completedLogs} / {encounterCount} ({logCoveragePercent}%)
                </span>
              </div>
              <Progress value={logCoveragePercent} className="h-1.5" aria-label="Log coverage" />
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            <Button asChild size="sm">
              <Link href={`/admin/tournaments/${tournament.id}`}>
                Open tournament
                <ArrowRight className="size-3.5" aria-hidden />
              </Link>
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link href="/admin/tournaments">View all tournaments</Link>
            </Button>
          </div>
        </div>
      </SurfaceCardContent>
    </SurfaceCard>
  );
}
