"use client";

import Link from "next/link";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { BarChart3, CalendarDays, CheckCircle2, Layers3, Loader2, Users } from "lucide-react";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { TONE_CLASS } from "@/components/admin/tone";
import { notify } from "@/lib/notify";
import adminService from "@/services/admin.service";
import type { Tournament } from "@/types/tournament.types";
import { formatDate } from "./tournamentWorkspace.helpers";
import { invalidateTournamentWorkspace } from "./tournamentWorkspace.queryKeys";

type MetricCount = number | null;

interface TournamentWorkspaceHeaderProps {
  tournament: Tournament;
  tournamentId: number;
  teamsCount: MetricCount;
  teamsCountLoading: boolean;
  encountersCount: MetricCount;
  encountersCountLoading: boolean;
  standingsCount: MetricCount;
  standingsCountLoading: boolean;
  canReadAnalytics: boolean;
  canToggleFinished: boolean;
}

function formatMetricCount(value: MetricCount, isLoading: boolean) {
  if (typeof value === "number") {
    return value.toString();
  }

  return isLoading ? "…" : "—";
}

/**
 * Tournament hub title bar.
 *
 * Deliberately carries NO status readout. It used to state the same status
 * four contradictory ways at once — an `XCircle` glyph labelled "Live ops" in
 * the success colour, a "Draft" badge, an "Active · Tournament" meta line, and
 * the stepper's current phase. Phase now lives only in `PhaseStepper`, which
 * also owns the single `TournamentStatusControl`.
 *
 * "Back to tournaments" and "Edit tournament" are gone too: the breadcrumb and
 * sidebar already reach the list, and the edit button only pushed to the
 * Settings tab that sits in the tab bar two rows below it.
 *
 * The name is screen-reader-only and the dates/counts share the action row:
 * the breadcrumb resolves the same tournament name one line above, so printing
 * it again bought a heading row and no information.
 */
export function TournamentWorkspaceHeader({
  tournament,
  tournamentId,
  teamsCount,
  teamsCountLoading,
  encountersCount,
  encountersCountLoading,
  standingsCount,
  standingsCountLoading,
  canReadAnalytics,
  canToggleFinished
}: Readonly<TournamentWorkspaceHeaderProps>) {
  const queryClient = useQueryClient();

  const toggleFinishedMutation = useMutation({
    mutationFn: () => adminService.toggleTournamentFinished(tournamentId),
    onSuccess: () => {
      invalidateTournamentWorkspace(queryClient, tournamentId);
      notify.success(
        tournament.is_finished ? "Tournament reopened" : "Tournament marked as finished"
      );
    }
  });

  return (
    <AdminPageHeader
      title={tournament.name}
      titleHidden
      meta={
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
          {/* Only leagues get a chip: a "Tournament" badge on the tournament
              workspace restated the noun in the breadcrumb above it. */}
          {tournament.is_league ? (
            <Badge variant="outline" className={TONE_CLASS.info}>
              League
            </Badge>
          ) : null}
          <span className="flex items-center gap-1.5">
            <CalendarDays className="size-3.5" aria-hidden />
            <span className="tabular-nums">
              {formatDate(tournament.start_date)} — {formatDate(tournament.end_date)}
            </span>
          </span>
          <span className="flex items-center gap-1.5">
            <Users className="size-3.5" aria-hidden />
            <span className="tabular-nums">
              {formatMetricCount(teamsCount, teamsCountLoading)} teams /{" "}
              {formatMetricCount(tournament.participants_count ?? teamsCount, teamsCountLoading)}{" "}
              participants
            </span>
          </span>
          <span className="flex items-center gap-1.5">
            <Layers3 className="size-3.5" aria-hidden />
            <span className="tabular-nums">
              {tournament.stages.length} stages /{" "}
              {formatMetricCount(encountersCount, encountersCountLoading)} encounters /{" "}
              {formatMetricCount(standingsCount, standingsCountLoading)} standings
            </span>
          </span>
        </div>
      }
      actions={
        <>
          {canReadAnalytics ? (
            <Button asChild variant="outline" size="sm">
              <Link href={`/tournaments/analytics?tournamentId=${tournament.id}`}>
                <BarChart3 className="mr-2 size-4" aria-hidden />
                Open analytics
              </Link>
            </Button>
          ) : null}
          {canToggleFinished ? (
            <Button
              size="sm"
              onClick={() => toggleFinishedMutation.mutate()}
              disabled={toggleFinishedMutation.isPending}
            >
              {toggleFinishedMutation.isPending ? (
                <Loader2 className="mr-2 size-4 animate-spin" aria-hidden />
              ) : (
                <CheckCircle2 className="mr-2 size-4" aria-hidden />
              )}
              {tournament.is_finished ? "Reopen tournament" : "Mark as finished"}
            </Button>
          ) : null}
        </>
      }
    />
  );
}
