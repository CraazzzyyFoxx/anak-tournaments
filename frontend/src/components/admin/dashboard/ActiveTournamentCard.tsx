"use client";

import Link from "next/link";
import { ArrowRight, Calendar } from "lucide-react";

import { Button } from "@/components/ui/button";
import { CardTitle } from "@/components/ui/card";
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
}

/**
 * The active tournament, as a header: what it is, when, and the one way in.
 *
 * It used to carry a log-coverage bar and a "View all tournaments" button as
 * well — the KPI strip above already states log coverage, and Recent
 * tournaments beside it already links the list, so both said something the
 * screen was already saying.
 */
export function ActiveTournamentCard({ canRead, tournament }: Readonly<ActiveTournamentCardProps>) {
  if (!canRead) {
    return (
      <SurfaceCard>
        <SurfaceCardContent className="pt-5">
          <PermissionHiddenNotice title="Tournament data is hidden" permission="tournament read" />
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
      <SurfaceCardContent className="flex flex-wrap items-start justify-between gap-4 pt-5">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span
              className={cn(
                "flex items-center gap-1.5 rounded-md border px-2 py-0.5 font-medium",
                TONE_CLASS[status.tone]
              )}
            >
              {!tournament.is_finished && (
                <span
                  className="size-1.5 animate-pulse rounded-full bg-current motion-reduce:animate-none"
                  aria-hidden
                />
              )}
              {status.label}
            </span>
            {tournament.is_league ? "League" : "Tournament"}
          </div>

          <CardTitle asChild className="mt-2 line-clamp-1 text-xl text-foreground">
            <h2>{tournament.name}</h2>
          </CardTitle>

          {/* Dates, stage count and stage names on one line — the only place
              the stage count is stated. */}
          <p className="mt-1 flex min-w-0 flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground">
            <Calendar className="size-3.5 shrink-0" aria-hidden />
            <span className="tabular-nums">
              {formatDate(tournament.start_date)} — {formatDate(tournament.end_date)}
            </span>
            {stageCount > 0 && (
              <>
                <span aria-hidden>·</span>
                <span className="tabular-nums">
                  {stageCount} stage{stageCount === 1 ? "" : "s"}
                </span>
              </>
            )}
            {stageList && (
              <>
                <span aria-hidden>·</span>
                <span className="truncate" title={stageList}>
                  {stageList}
                </span>
              </>
            )}
          </p>
        </div>

        <Button asChild size="sm" className="shrink-0">
          <Link href={`/admin/tournaments/${tournament.id}`}>
            Open tournament
            <ArrowRight className="size-3.5" aria-hidden />
          </Link>
        </Button>
      </SurfaceCardContent>
    </SurfaceCard>
  );
}
