"use client";

import React from "react";
import { Activity, Calendar, ExternalLink, Users } from "lucide-react";

import { Breadcrumb } from "@/components/Breadcrumb";
import { Skeleton } from "@/components/ui/skeleton";
import { TournamentChallongeLinkInline } from "@/app/(site)/tournaments/components/TournamentCard";
import TournamentRegisterButton from "./TournamentRegisterButton";
import { getTournamentStatusMeta, isTournamentStatusEnded } from "@/lib/tournament-status";
import { cn, formatDateRange } from "@/lib/utils";
import { useTournamentRealtime } from "@/hooks/useTournamentRealtime";
import { useTournamentQuery, useTournamentStagesQuery } from "../_hooks/useTournamentClientData";

import TournamentSectionNav from "./TournamentSectionNav";

type TournamentClientLayoutProps = {
  tournamentId: number;
  children: React.ReactNode;
};

function TournamentLayoutSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-6 md:grid-cols-[220px_minmax(0,1fr)]">
      <aside className="hidden md:block">
        <div className="sticky top-20 rounded-xl border border-white/[0.07] bg-white/[0.02] p-2">
          <div className="flex flex-col gap-2">
            <Skeleton className="h-10 w-full rounded-lg" />
            <Skeleton className="h-10 w-full rounded-lg" />
            <Skeleton className="h-10 w-full rounded-lg" />
            <Skeleton className="h-10 w-full rounded-lg" />
          </div>
        </div>
      </aside>
      <div className="min-w-0 space-y-5">
        <Skeleton className="h-4 w-64" />
        <Skeleton className="h-48 w-full rounded-xl" />
        <Skeleton className="h-72 w-full rounded-xl" />
      </div>
    </div>
  );
}

export default function TournamentClientLayout({
  tournamentId,
  children,
}: TournamentClientLayoutProps) {
  const tournamentQuery = useTournamentQuery(tournamentId);
  const stagesQuery = useTournamentStagesQuery(tournamentId);
  const tournament = tournamentQuery.data;
  const stages = stagesQuery.data ?? [];

  useTournamentRealtime({
    tournamentId,
    workspaceId: tournament?.workspace_id,
  });

  if (tournamentQuery.isLoading || stagesQuery.isLoading) {
    return <TournamentLayoutSkeleton />;
  }

  if (!tournament) {
    return (
      <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] px-4 py-8 text-center text-muted-foreground">
        Tournament not found.
      </div>
    );
  }

  const statusMeta = getTournamentStatusMeta(tournament.status);
  const isEnded = isTournamentStatusEnded(tournament.status);

  return (
    <div className="grid grid-cols-1 gap-6 md:grid-cols-[220px_minmax(0,1fr)]">
      <aside className="hidden md:block">
        <div className="sticky top-20">
          <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-2">
            <TournamentSectionNav
              tournamentId={String(tournamentId)}
              status={tournament.status}
              stages={stages}
              variant="desktop"
            />
          </div>
        </div>
      </aside>

      <div className="min-w-0 space-y-5">
        <Breadcrumb
          items={[
            { label: "Tournaments", href: "/tournaments" },
            { label: tournament.name },
          ]}
        />

        <div
          className={cn(
            "rounded-xl border border-white/[0.07] bg-white/[0.02] p-6",
            tournament.is_league && "border-l-2 border-l-purple-500/50",
          )}
        >
          <div className="mb-4 flex flex-wrap items-center gap-2">
            {!tournament.is_league && (
              <span className="font-mono text-xs tabular-nums text-white/40">
                #{tournament.number}
              </span>
            )}
            {tournament.is_league && (
              <span className="inline-flex items-center rounded-full border border-purple-500/20 bg-purple-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-purple-400">
                League
              </span>
            )}
            <span
              className={cn(
                "inline-flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide",
                statusMeta.badgeClassName,
              )}
            >
              {statusMeta.dotClassName ? (
                <span
                  className={cn(
                    "h-1.5 w-1.5 rounded-full",
                    statusMeta.dotClassName,
                    tournament.status === "live" && "animate-pulse",
                  )}
                />
              ) : null}
              {statusMeta.badgeLabel}
            </span>
          </div>

          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <h1 className="text-2xl font-semibold tracking-tight text-white">
                {tournament.name}
              </h1>
              {tournament.description && (
                <p className="mt-2 max-w-prose text-sm leading-relaxed text-white/50">
                  {tournament.description}
                </p>
              )}
            </div>
            {!isEnded && (
              <div className="shrink-0">
                <TournamentRegisterButton
                  workspaceId={tournament.workspace_id}
                  tournamentId={tournament.id}
                  tournamentName={tournament.name}
                />
              </div>
            )}
          </div>

          {(() => {
            const hasChallonge =
              Boolean(tournament.challonge_slug) ||
              stages.some((stage) => Boolean(stage.challonge_slug));
            return (
              <div
                className={cn(
                  "mt-5 grid grid-cols-2 gap-3",
                  hasChallonge ? "lg:grid-cols-4" : "lg:grid-cols-3",
                )}
              >
                <div className="flex items-center gap-3 rounded-lg border border-white/[0.06] bg-white/[0.02] p-3">
                  <Calendar className="h-4 w-4 shrink-0 text-white/30" />
                  <div className="min-w-0">
                    <div className="mb-0.5 text-[10px] uppercase tracking-wide text-white/40">
                      Dates
                    </div>
                    <div className="truncate text-sm font-medium text-white/80">
                      {formatDateRange(tournament.start_date, tournament.end_date)}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-3 rounded-lg border border-white/[0.06] bg-white/[0.02] p-3">
                  <Users className="h-4 w-4 shrink-0 text-white/30" />
                  <div className="min-w-0">
                    <div className="mb-0.5 text-[10px] uppercase tracking-wide text-white/40">
                      Participants
                    </div>
                    <div className="truncate text-sm font-medium text-white/80">
                      {tournament.participants_count ?? 0}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-3 rounded-lg border border-white/[0.06] bg-white/[0.02] p-3">
                  <Activity className="h-4 w-4 shrink-0 text-white/30" />
                  <div className="min-w-0">
                    <div className="mb-0.5 text-[10px] uppercase tracking-wide text-white/40">
                      Status
                    </div>
                    <div className={cn("text-sm font-medium", statusMeta.textClassName)}>
                      {statusMeta.label}
                    </div>
                  </div>
                </div>

                {hasChallonge && (
                  <div className="flex items-center gap-3 rounded-lg border border-white/[0.06] bg-white/[0.02] p-3">
                    <ExternalLink className="h-4 w-4 shrink-0 text-white/30" />
                    <div className="min-w-0">
                      <div className="mb-0.5 text-[10px] uppercase tracking-wide text-white/40">
                        Bracket
                      </div>
                      <TournamentChallongeLinkInline tournament={tournament} stages={stages} />
                    </div>
                  </div>
                )}
              </div>
            );
          })()}
        </div>

        <div className="md:hidden">
          <TournamentSectionNav
            tournamentId={String(tournamentId)}
            status={tournament.status}
            stages={stages}
            variant="mobile"
          />
        </div>

        <section className="min-w-0">{children}</section>
      </div>
    </div>
  );
}
