"use client";

import type { ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { usePermissions } from "@/hooks/usePermissions";
import { useTournamentRealtime } from "@/hooks/useTournamentRealtime";
import adminService from "@/services/admin.service";
import encounterService from "@/services/encounter.service";
import teamService from "@/services/team.service";
import tournamentService from "@/services/tournament.service";
import workspaceService from "@/services/workspace.service";
import type { DivisionGridVersion } from "@/types/workspace.types";
import { TournamentWorkspaceHeader } from "./components/TournamentWorkspaceHeader";

const TOURNAMENT_WORKSPACE_REFRESH_INTERVAL_MS = 60_000;

/**
 * Client shell of the tournament hub (§1.1): owns the permission gate, the
 * workspace header, the single `useTournamentRealtime` mount and the shared
 * queries. Query keys MUST stay identical to the tab pages — realtime
 * patch-in-cache and workspace invalidation depend on them
 * (see components/tournamentWorkspace.queryKeys.ts).
 */
export function TournamentHubShell({
  tournamentId,
  children
}: Readonly<{
  tournamentId: number;
  children: ReactNode;
}>) {
  const router = useRouter();
  const isValidTournamentId = Number.isFinite(tournamentId) && tournamentId > 0;
  const { canAccessPermission, isLoaded: permissionsLoaded, isSuperuser } = usePermissions();

  const tournamentQuery = useQuery({
    queryKey: ["admin", "tournament", tournamentId],
    queryFn: () => adminService.getTournament(tournamentId),
    enabled: isValidTournamentId
  });

  const teamsCountQuery = useQuery({
    queryKey: ["admin", "tournament", tournamentId, "teams", "count"],
    queryFn: () => teamService.getCount(tournamentId),
    enabled: isValidTournamentId,
    refetchInterval: TOURNAMENT_WORKSPACE_REFRESH_INTERVAL_MS,
    refetchIntervalInBackground: true
  });

  const encountersCountQuery = useQuery({
    queryKey: ["admin", "tournament", tournamentId, "encounters", "count"],
    queryFn: () => encounterService.getCount(tournamentId),
    enabled: isValidTournamentId,
    refetchInterval: TOURNAMENT_WORKSPACE_REFRESH_INTERVAL_MS,
    refetchIntervalInBackground: true
  });

  const stagesQuery = useQuery({
    queryKey: ["admin", "stages", tournamentId],
    queryFn: () => adminService.getStages(tournamentId),
    enabled: isValidTournamentId
  });

  const standingsQuery = useQuery({
    queryKey: ["admin", "tournament", tournamentId, "standings"],
    queryFn: () =>
      tournamentService.getStandings(tournamentId, {
        includeMatchesHistory: false,
        includeTeamGroup: false
      }),
    enabled: isValidTournamentId,
    refetchInterval: TOURNAMENT_WORKSPACE_REFRESH_INTERVAL_MS,
    refetchIntervalInBackground: true
  });

  const divisionGridsQuery = useQuery({
    queryKey: ["admin", "tournament", tournamentId, "division-grids"],
    queryFn: async () => {
      const workspaceId = tournamentQuery.data?.workspace_id;
      if (!workspaceId) return [];
      return workspaceService.getDivisionGrids(workspaceId);
    },
    enabled: Boolean(tournamentQuery.data?.workspace_id)
  });

  const tournamentWorkspaceId = tournamentQuery.data?.workspace_id ?? null;
  // The one and only realtime mount of the hub — tab pages must not mount it.
  useTournamentRealtime({
    tournamentId: isValidTournamentId ? tournamentId : null,
    workspaceId: tournamentWorkspaceId
  });

  const tournament = tournamentQuery.data;
  const canUpdateTournament = canAccessPermission("tournament.update", tournamentWorkspaceId);
  const canDeleteTournament = canAccessPermission("tournament.delete", tournamentWorkspaceId);
  const canReadAnalytics = canAccessPermission("analytics.read", tournamentWorkspaceId);
  const canCreateTeam = canAccessPermission("team.create", tournamentWorkspaceId);
  const canUpdateTeam = canAccessPermission("team.update", tournamentWorkspaceId);
  const canDeleteTeam = canAccessPermission("team.delete", tournamentWorkspaceId);
  const canImportTeams = canAccessPermission("team.import", tournamentWorkspaceId);
  const canCreatePlayer = canAccessPermission("player.create", tournamentWorkspaceId);
  const canUpdatePlayer = canAccessPermission("player.update", tournamentWorkspaceId);
  const canDeletePlayer = canAccessPermission("player.delete", tournamentWorkspaceId);
  const canCreateEncounter = canAccessPermission("match.create", tournamentWorkspaceId);
  const canUpdateEncounter = canAccessPermission("match.update", tournamentWorkspaceId);
  const canDeleteEncounter = canAccessPermission("match.delete", tournamentWorkspaceId);
  const canSyncEncounters = canAccessPermission("match.sync", tournamentWorkspaceId);
  const canUpdateStanding = canAccessPermission("standing.update", tournamentWorkspaceId);
  const canDeleteStanding = canAccessPermission("standing.delete", tournamentWorkspaceId);
  const canRecalculateStandings = canAccessPermission(
    "standing.recalculate",
    tournamentWorkspaceId
  );

  const teamsCount = teamsCountQuery.data ?? null;
  const encountersCount = encountersCountQuery.data ?? null;
  const standingsCount = standingsQuery.data?.length ?? null;
  const divisionGridVersions: DivisionGridVersion[] = (divisionGridsQuery.data ?? [])
    .flatMap((grid) => grid.versions)
    .slice()
    .sort((left, right) => right.version - left.version);

  if (tournamentQuery.isLoading || stagesQuery.isLoading || !permissionsLoaded) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-28 w-full rounded-xl" />
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <Skeleton className="h-24 rounded-xl" />
          <Skeleton className="h-24 rounded-xl" />
          <Skeleton className="h-24 rounded-xl" />
          <Skeleton className="h-24 rounded-xl" />
        </div>
        <Skeleton className="h-96 w-full rounded-xl" />
      </div>
    );
  }

  if (!tournament) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Tournament not found</CardTitle>
          <CardDescription>The requested admin workspace could not be loaded.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  if (
    !isSuperuser &&
    ![
      canUpdateTournament,
      canDeleteTournament,
      canReadAnalytics,
      canCreateTeam,
      canUpdateTeam,
      canDeleteTeam,
      canImportTeams,
      canCreatePlayer,
      canUpdatePlayer,
      canDeletePlayer,
      canCreateEncounter,
      canUpdateEncounter,
      canDeleteEncounter,
      canSyncEncounters,
      canUpdateStanding,
      canDeleteStanding,
      canRecalculateStandings
    ].some(Boolean)
  ) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Unauthorized</CardTitle>
          <CardDescription>
            You do not have permission to access this tournament workspace.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <TournamentWorkspaceHeader
        tournament={tournament}
        tournamentId={tournamentId}
        teamsCount={teamsCount}
        teamsCountLoading={teamsCount == null && teamsCountQuery.isLoading}
        encountersCount={encountersCount}
        encountersCountLoading={encountersCount == null && encountersCountQuery.isLoading}
        standingsCount={standingsCount}
        standingsCountLoading={standingsCount == null && standingsQuery.isLoading}
        canReadAnalytics={canReadAnalytics}
        canUpdateTournament={canUpdateTournament}
        canDeleteTournament={canDeleteTournament}
        canToggleFinished={canUpdateTournament && isSuperuser}
        divisionGridVersions={divisionGridVersions}
        divisionGridLoading={divisionGridsQuery.isLoading}
        // Transitional bridge until T5 turns tabs into routes: page.tsx
        // consumes `?tab=settings` and switches its local tab state.
        onEditClick={() => router.push("?tab=settings", { scroll: false })}
      />
      {children}
    </div>
  );
}
