"use client";

import { HoverPrefetchLink } from "@/components/HoverPrefetchLink";
import { useTranslations } from "next-intl";
import { ArrowRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusPill } from "@/components/kit/StatusPill";
import { formatTournamentStages } from "@/lib/tournament/stages";
import { PermissionHiddenNotice } from "./PermissionHiddenNotice";
import type { Tournament } from "@/types/tournament.types";

interface RecentTournamentsProps {
  canRead: boolean;
  tournaments: Tournament[];
  /** The tournament the active card already shows; not listed twice. */
  excludeId?: number;
}

export function RecentTournaments({ canRead, tournaments, excludeId }: Readonly<RecentTournamentsProps>) {
  const t = useTranslations("adminShell.dashboard");
  const recent = tournaments.filter((tournament) => tournament.id !== excludeId).slice(0, 6);

  // The only tournament is the one the active card shows: nothing else to list.
  if (canRead && recent.length === 0 && tournaments.length > 0) return null;

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
          <PermissionHiddenNotice
            title={t("tournamentQueueHidden")}
            description={t("permissionNoticeTournaments")}
          />
        ) : recent.length > 0 ? (
          <ul className="divide-y divide-border/50">
            {recent.map((tournament) => {
              const stageList = formatTournamentStages(tournament.stages ?? []);

              return (
                <li key={tournament.id}>
                  {/* Bleeds to the card edge so the hover fill spans the card. */}
                  <HoverPrefetchLink
                    href={`/admin/tournaments/${tournament.id}`}
                    className="-mx-6 flex items-center justify-between gap-3 px-6 py-2.5 transition-colors hover:bg-accent/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium text-foreground">{tournament.name}</div>
                      {stageList ? (
                        <div className="mt-0.5 truncate text-xs text-muted-foreground" title={stageList}>
                          {stageList}
                        </div>
                      ) : null}
                    </div>
                    {/* Most of this list is finished: only a running one is worth a pill. */}
                    {tournament.is_finished ? null : (
                      <StatusPill tone="success" className="shrink-0">
                        {t("active")}
                      </StatusPill>
                    )}
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
