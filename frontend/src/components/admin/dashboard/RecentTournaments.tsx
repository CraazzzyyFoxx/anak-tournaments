"use client";

import Link from "next/link";
import { ArrowRight, Layers3 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CardTitle } from "@/components/ui/card";
import { TONE_CLASS } from "@/components/admin/tone";
import { formatTournamentStages } from "@/lib/tournament-stages";
import { cn } from "@/lib/utils";
import { PermissionHiddenNotice } from "./PermissionHiddenNotice";
import { SurfaceCard, SurfaceCardContent, SurfaceCardHeader } from "./SurfaceCard";
import { tournamentStatus } from "./tournament-status";
import type { Tournament } from "@/types/tournament.types";

interface RecentTournamentsProps {
  canRead: boolean;
  tournaments: Tournament[];
}

export function RecentTournaments({ canRead, tournaments }: Readonly<RecentTournamentsProps>) {
  return (
    <SurfaceCard className="flex-1 flex flex-col">
      <SurfaceCardHeader>
        <div className="flex items-start justify-between gap-3">
          <CardTitle asChild className="text-sm">
            <h2>Recent tournaments</h2>
          </CardTitle>
          {canRead && (
            <Button asChild variant="ghost" size="sm" className="-mt-1 shrink-0 text-muted-foreground">
              <Link href="/admin/tournaments">
                View all tournaments
                <ArrowRight className="size-3.5" aria-hidden />
              </Link>
            </Button>
          )}
        </div>
      </SurfaceCardHeader>
      <SurfaceCardContent className="flex-1 flex flex-col">
        {!canRead ? (
          <PermissionHiddenNotice
            title="Tournament queue is hidden"
            permission="tournament read"
          />
        ) : tournaments.length > 0 ? (
          <div className="divide-y divide-border/50 rounded-xl border border-border/50 overflow-hidden flex-1 flex flex-col">
            {tournaments.slice(0, 6).map((t) => {
              const stageCount = t.stages?.length ?? 0;
              const stageList = formatTournamentStages(t.stages ?? []) || "No stages yet";
              const status = tournamentStatus(t.is_finished);

              return (
                <Link
                  key={t.id}
                  href={`/admin/tournaments/${t.id}`}
                  className="flex items-center justify-between gap-3 bg-background/40 px-3 py-2.5 transition-colors hover:bg-accent/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-foreground">{t.name}</div>
                    <div className="mt-0.5 truncate text-xs text-muted-foreground" title={stageList}>
                      {stageList}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="flex items-center gap-1 text-xs tabular-nums text-muted-foreground">
                      <Layers3 className="size-3" aria-hidden />
                      {stageCount}
                      <span className="sr-only"> stages</span>
                    </span>
                    <Badge variant="outline" className={cn("text-xs", TONE_CLASS[status.tone])}>
                      {status.label}
                    </Badge>
                  </div>
                </Link>
              );
            })}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            No tournaments yet. Create one to start tracking stages, teams and logs here.
          </p>
        )}
      </SurfaceCardContent>
    </SurfaceCard>
  );
}
