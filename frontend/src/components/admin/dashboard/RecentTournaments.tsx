"use client";

import { HoverPrefetchLink } from "@/components/HoverPrefetchLink";
import { useTranslations } from "next-intl";
import { ArrowRight, Layers3 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusPill } from "@/components/kit/StatusPill";
import { formatTournamentStages } from "@/lib/tournament/stages";
import { PermissionHiddenNotice } from "./PermissionHiddenNotice";
import { tournamentStatus } from "./tournament-status";
import type { Tournament } from "@/types/tournament.types";

interface RecentTournamentsProps {
  canRead: boolean;
  tournaments: Tournament[];
}

export function RecentTournaments({ canRead, tournaments }: Readonly<RecentTournamentsProps>) {
  const t = useTranslations("adminShell.dashboard");
  return (
    <Card className="flex flex-1 flex-col">
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <CardTitle asChild>
            <h2>{t("recentTournaments")}</h2>
          </CardTitle>
          {canRead && (
            <Button
              asChild
              variant="ghost"
              size="sm"
              className="-mt-1.5 shrink-0 text-muted-foreground"
            >
              <HoverPrefetchLink href="/admin/tournaments">
                {t("viewAllTournaments")}
                <ArrowRight className="size-3.5" aria-hidden />
              </HoverPrefetchLink>
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col">
        {!canRead ? (
          <PermissionHiddenNotice title={t("tournamentQueueHidden")} permission="tournament read" />
        ) : tournaments.length > 0 ? (
          <ul className="divide-y divide-border/50">
            {tournaments.slice(0, 6).map((tournament) => {
              const stageCount = tournament.stages?.length ?? 0;
              const stageList = formatTournamentStages(tournament.stages ?? []) || t("noStagesYet");
              const status = tournamentStatus(tournament.is_finished);

              return (
                <li key={tournament.id}>
                  {/* Bleeds to the card edge so the hover fill spans the card. */}
                  <HoverPrefetchLink
                    href={`/admin/tournaments/${tournament.id}`}
                    className="-mx-6 flex items-center justify-between gap-3 px-6 py-2.5 transition-colors hover:bg-accent/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium text-foreground">{tournament.name}</div>
                      <div
                        className="mt-0.5 truncate text-xs text-muted-foreground"
                        title={stageList}
                      >
                        {stageList}
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <span className="flex items-center gap-1 text-xs tabular-nums text-muted-foreground">
                        <Layers3 className="size-3" aria-hidden />
                        {stageCount}
                        <span className="sr-only"> {t("stageUnit", { count: stageCount })}</span>
                      </span>
                      <StatusPill tone={status.tone}>{t(status.label as never)}</StatusPill>
                    </div>
                  </HoverPrefetchLink>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">
            {t("noTournamentsYet")}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
