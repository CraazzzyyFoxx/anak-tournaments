"use client";

import { HoverPrefetchLink } from "@/components/HoverPrefetchLink";
import { useTranslations } from "next-intl";
import { ArrowRight } from "lucide-react";
import { useFormatter } from "@/lib/datetime/client";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardTitle } from "@/components/ui/card";
import { formatTournamentStages } from "@/lib/tournament/stages";
import { PermissionHiddenNotice } from "./PermissionHiddenNotice";
import type { Tournament } from "@/types/tournament.types";

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
  const t = useTranslations("adminShell.dashboard");
  const tExtra = useTranslations("adminShell.dashboardExtra");
  const format = useFormatter();
  if (!canRead) {
    return (
      <Card>
        <CardContent className="pt-6">
          <PermissionHiddenNotice
            title={t("tournamentDataHidden")}
            description={t("permissionNoticeTournaments")}
          />
        </CardContent>
      </Card>
    );
  }

  if (!tournament) {
    return (
      <Card>
        <CardContent className="flex flex-col gap-3 pt-6">
          <p className="text-sm text-muted-foreground">
            {t("noActiveTournaments")}
          </p>
          <Button asChild variant="outline" size="sm" className="w-fit">
            <HoverPrefetchLink href="/admin/tournaments">
              {t("viewAllTournaments")}
              <ArrowRight className="size-3.5" aria-hidden />
            </HoverPrefetchLink>
          </Button>
        </CardContent>
      </Card>
    );
  }

  // A tournament day is stored as a UTC midnight, so it is read in UTC — any
  // other zone shifts it. A missing end leaves the start alone, never a dash.
  const dates = [tournament.start_date, tournament.end_date]
    .filter((value) => value != null)
    .map((value) => format.dateTime(new Date(value), { dateStyle: "medium", timeZone: "UTC" }))
    .join(" – ");
  // The dashboard falls back to the latest tournament when none is running,
  // so "Finished" is said in words, never as a pill on the "active" card.
  const meta = [
    tournament.is_league ? tExtra("league") : null,
    tournament.is_finished ? t("finished") : null,
    dates,
    formatTournamentStages(tournament.stages ?? [])
  ].filter(Boolean);

  return (
    <Card>
      <CardContent className="flex flex-wrap items-start justify-between gap-4 pt-6">
        <div className="min-w-0 flex-1">
          <CardTitle asChild className="line-clamp-1 text-xl text-foreground">
            <h2>{tournament.name}</h2>
          </CardTitle>

          {meta.length > 0 ? (
            <p className="mt-1 truncate text-xs tabular-nums text-muted-foreground" title={meta.join(" · ")}>
              {meta.join(" · ")}
            </p>
          ) : null}
        </div>

        <Button asChild size="sm" className="shrink-0">
          <HoverPrefetchLink href={`/admin/tournaments/${tournament.id}`}>
            {t("openTournament")}
            <ArrowRight className="size-3.5" aria-hidden />
          </HoverPrefetchLink>
        </Button>
      </CardContent>
    </Card>
  );
}
