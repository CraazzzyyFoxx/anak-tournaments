"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { usePermissions } from "@/hooks/usePermissions";
import { useCurrentWorkspaceId } from "@/hooks/useCurrentWorkspace";
import { apiFetch } from "@/lib/api-fetch";
import { cn } from "@/lib/utils";
import adminService from "@/services/admin.service";
import { getTournamentWorkspaceQueryKeys } from "@/app/admin/tournaments/[id]/components/tournamentWorkspace.queryKeys";
import tournamentService from "@/services/tournament.service";
import type { PaginatedResponse } from "@/types/pagination.types";
import type { Tournament } from "@/types/tournament.types";

import { GreetingBar } from "@/components/admin/dashboard/GreetingBar";
import { KpiStrip, kpiColumnsClass } from "@/components/admin/dashboard/KpiStrip";
import { ActiveTournamentCard } from "@/components/admin/dashboard/ActiveTournamentCard";
import { ActiveTournamentReadiness } from "@/components/admin/dashboard/ActiveTournamentReadiness";
import { IssuesQueue, type IssueItem } from "@/components/admin/dashboard/IssuesQueue";
import { RecentTournaments } from "@/components/admin/dashboard/RecentTournaments";

interface DashboardActiveTournamentStats {
  encounters_total: number;
  encounters_missing_logs: number;
  log_coverage_percent: number;
}

/** Mirrors backend/app-service/src/schemas/statistics.py:DashboardIssues. */
interface DashboardIssues {
  encounters_missing_logs: number;
  teams_without_players: number;
  tournaments_without_stages: number;
  users_without_identities: number;
  encounters_awaiting_result: number;
  encounters_pending_confirmation: number;
  stage_slots_empty: number;
}

/** Mirrors backend/app-service/src/schemas/statistics.py:DashboardStats. */
interface DashboardStats {
  tournaments_total: number;
  tournaments_active: number;
  teams_total: number;
  players_total: number;
  encounters_total: number;
  tournaments_registration_open: number;
  encounters_completed: number;
  active_tournament_stats: DashboardActiveTournamentStats | null;
  issues: DashboardIssues;
}

function emptyPaginated<T>(): PaginatedResponse<T> {
  return { results: [], total: 0, page: 1, per_page: 0 };
}

export default function AdminDashboard() {
  const { canAccessPermission } = usePermissions();
  const workspaceId = useCurrentWorkspaceId();

  const canReadTournaments = canAccessPermission("tournament.read", workspaceId);
  const canCreateTournaments = canAccessPermission("tournament.create", workspaceId);
  const canReadTeams = canAccessPermission("team.read", workspaceId);
  const canReadMatches = canAccessPermission("match.read", workspaceId);
  const canReadUsers = canAccessPermission("user.read", workspaceId);

  // Aggregated counts from backend (single lightweight query). `workspace_id` is
  // injected by apiFetch, so it MUST be part of the key or a workspace switch
  // serves the previous workspace's numbers.
  const statsQuery = useQuery({
    queryKey: ["admin", "dashboard", "stats", workspaceId],
    queryFn: () =>
      apiFetch("/api/v1/statistics/dashboard").then((r) => r.json() as Promise<DashboardStats>),
  });

  // Tournaments still needed for Active Tournament Card & Recent Tournaments display
  const tournamentsQuery = useQuery({
    queryKey: ["admin", "dashboard", "tournaments", workspaceId],
    queryFn: () =>
      canReadTournaments
        ? tournamentService.getAll(null)
        : Promise.resolve(emptyPaginated<Tournament>()),
  });

  const stats = statsQuery.data;
  const tournaments = tournamentsQuery.data?.results ?? [];

  const activeTournament = useMemo(() => {
    if (!canReadTournaments) return null;
    const visible = tournaments.filter((t) => !t.is_hidden);
    return visible.find((t) => !t.is_finished) ?? visible[0] ?? null;
  }, [tournaments, canReadTournaments]);

  // The readiness aggregate masks field groups the reader cannot see, so either
  // permission is enough to render something useful. The key is the hub's own
  // readiness key: identical data under one cache entry, so navigating to the
  // hub renders from cache and the hub's realtime invalidation reaches this too.
  const canReadReadiness = canReadTournaments || canReadTeams;
  const readinessQuery = useQuery({
    queryKey: getTournamentWorkspaceQueryKeys(activeTournament?.id ?? 0).readiness,
    queryFn: () => adminService.getTournamentReadiness(activeTournament!.id),
    enabled: canReadReadiness && activeTournament != null,
  });

  // One tile per KPI the reader may actually see — the loading skeleton reserves
  // the same count, so a two-permission role no longer gets a four-tile shimmer.
  const kpiCount = (canReadTournaments ? 2 : 0) + (canReadMatches ? 2 : 0);

  const derived = useMemo(() => {
    const activeStats = stats?.active_tournament_stats;
    const encounterCount = activeStats?.encounters_total ?? 0;
    const missingLogs = activeStats?.encounters_missing_logs ?? 0;
    const logCoveragePercent = activeStats?.log_coverage_percent ?? 100;

    const issues = stats?.issues;
    const issueItems: IssueItem[] = [
      canReadMatches && (issues?.encounters_pending_confirmation ?? 0) > 0
        ? {
            label: "Results awaiting confirmation",
            count: issues!.encounters_pending_confirmation,
            href: "/admin/encounters",
            tone: "critical" as const,
          }
        : null,
      canReadMatches && (issues?.encounters_awaiting_result ?? 0) > 0
        ? {
            label: "Overdue match results",
            count: issues!.encounters_awaiting_result,
            href: "/admin/encounters",
            tone: "critical" as const,
          }
        : null,
      // Warning, not critical: an unrecorded or unconfirmed result blocks the
      // bracket, a missing log only blocks statistics.
      canReadMatches && (issues?.encounters_missing_logs ?? 0) > 0
        ? {
            label: "Missing encounter logs",
            count: issues!.encounters_missing_logs,
            href: "/admin/encounters",
            tone: "warning" as const,
          }
        : null,
      canReadTournaments && (issues?.stage_slots_empty ?? 0) > 0
        ? {
            label: "Empty bracket slots",
            count: issues!.stage_slots_empty,
            href: "/admin/tournaments",
            tone: "warning" as const,
          }
        : null,
      canReadTeams && (issues?.teams_without_players ?? 0) > 0
        ? {
            label: "Teams without rosters",
            count: issues!.teams_without_players,
            href: "/admin/teams",
            tone: "warning" as const,
          }
        : null,
      canReadTournaments && (issues?.tournaments_without_stages ?? 0) > 0
        ? {
            label: "Tournaments missing stages",
            count: issues!.tournaments_without_stages,
            href: "/admin/tournaments",
            tone: "warning" as const,
          }
        : null,
      canReadUsers && (issues?.users_without_identities ?? 0) > 0
        ? {
            label: "Unlinked player identities",
            count: issues!.users_without_identities,
            href: "/admin/users",
            tone: "info" as const,
          }
        : null,
    ].filter((item): item is IssueItem => item !== null);

    return { encounterCount, missingLogs, logCoveragePercent, issueItems };
  }, [stats, canReadMatches, canReadTeams, canReadTournaments, canReadUsers]);

  if (statsQuery.isLoading || tournamentsQuery.isLoading) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-14 rounded-2xl" />
        {kpiCount > 0 && (
          <div className={cn("grid gap-3 md:grid-cols-2", kpiColumnsClass(kpiCount))}>
            {Array.from({ length: kpiCount }).map((_, i) => (
              <Skeleton key={i} className="h-24 rounded-2xl" />
            ))}
          </div>
        )}
        <div className="grid gap-4 xl:grid-cols-[7fr_3fr]">
          <div className="flex flex-col gap-4">
            <Skeleton className="h-56 rounded-2xl" />
            <Skeleton className="h-64 rounded-2xl" />
          </div>
          <div className="flex flex-col gap-4">
            <Skeleton className="h-48 rounded-2xl" />
            <Skeleton className="h-64 rounded-2xl" />
          </div>
        </div>
      </div>
    );
  }

  const statsFailed = statsQuery.isError;
  const tournamentsFailed = tournamentsQuery.isError;

  return (
    <div className="flex flex-col gap-4">
      {/* [1] GREETING BAR */}
      <GreetingBar canCreateTournament={canCreateTournaments} />

      {/* [2] LOAD FAILURE — a failed fetch must not read as a real zero */}
      {(statsFailed || tournamentsFailed) && (
        <Alert variant="destructive">
          <AlertTriangle className="size-4" aria-hidden />
          <AlertTitle>Dashboard data failed to load</AlertTitle>
          <AlertDescription className="flex flex-wrap items-center gap-3">
            <span>
              {statsFailed && tournamentsFailed
                ? "Counts, the issue list and the tournament cards are unavailable."
                : statsFailed
                  ? "Counts and the issue list are unavailable."
                  : "The tournament cards are unavailable."}
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                if (statsFailed) void statsQuery.refetch();
                if (tournamentsFailed) void tournamentsQuery.refetch();
              }}
            >
              Retry
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {/* [3] DECISION METRICS */}
      {!statsFailed && (
        <KpiStrip
          tournaments={
            canReadTournaments
              ? { active: stats?.tournaments_active ?? 0, total: stats?.tournaments_total ?? 0 }
              : null
          }
          registrationOpen={
            canReadTournaments ? (stats?.tournaments_registration_open ?? 0) : null
          }
          matches={
            canReadMatches
              ? {
                  completed: stats?.encounters_completed ?? 0,
                  total: stats?.encounters_total ?? 0,
                }
              : null
          }
          logs={
            canReadMatches
              ? {
                  covered:
                    (stats?.encounters_total ?? 0) - (stats?.issues.encounters_missing_logs ?? 0),
                  total: stats?.encounters_total ?? 0,
                }
              : null
          }
        />
      )}

      {/* [4] WORK COLUMN + ATTENTION RAIL */}
      <section className={cn("grid gap-4", !tournamentsFailed && "xl:grid-cols-[7fr_3fr]")}>
        {!tournamentsFailed && (
          <div className="flex flex-col gap-4">
            <ActiveTournamentCard
              canRead={canReadTournaments}
              tournament={activeTournament}
              encounterCount={derived.encounterCount}
              missingLogs={derived.missingLogs}
              logCoveragePercent={derived.logCoveragePercent}
              canReadMatches={canReadMatches}
            />
            <ActiveTournamentReadiness
              canRead={canReadReadiness}
              tournament={activeTournament}
              readiness={readinessQuery.data}
              isLoading={readinessQuery.isLoading}
              failed={readinessQuery.isError}
            />
          </div>
        )}

        {(!statsFailed || !tournamentsFailed) && (
          <div className="flex flex-col gap-4">
            {!statsFailed && <IssuesQueue items={derived.issueItems} />}
            {!tournamentsFailed && (
              <RecentTournaments canRead={canReadTournaments} tournaments={tournaments} />
            )}
          </div>
        )}
      </section>
    </div>
  );
}
