"use client";

import { useCallback, useEffect, useRef, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { usePermissions } from "@/hooks/usePermissions";
import { useRealtimeCoalescedRefetch } from "@/hooks/useRealtimeCoalescedRefetch";
import { useRealtimeTopic } from "@/hooks/useRealtimeTopic";
import { useSyncActiveWorkspace } from "@/hooks/useSyncActiveWorkspace";
import { useTournamentRealtime } from "@/hooks/useTournamentRealtime";
import { tournamentQueryKeys } from "@/lib/tournament-query-keys";
import encounterService from "@/services/encounter.service";
import teamService from "@/services/team.service";
import { TournamentWorkspaceHeader } from "./components/TournamentWorkspaceHeader";
import { getTournamentWorkspaceQueryKeys } from "./components/tournamentWorkspace.queryKeys";
import {
  TOURNAMENT_WORKSPACE_REFRESH_INTERVAL_MS,
  useHubStagesQuery,
  useHubStandingsQuery,
  useHubTournamentQuery
} from "./hubQueries";
import { allowedTab, isTabKey, type TabKey } from "./tab-guards";

/**
 * Hub tab bar (D2, D20). `draft` is transitional and retires in Phase 2 with
 * a permanent redirect.
 *
 * `logs` is absent on purpose: it became a sub-tab of Play & Results and its old
 * top-level path now 308s. The key stays in `TAB_KEYS` so the shell still
 * resolves that path to a real tab while the redirect runs, instead of flashing
 * the overview guard on the way through.
 *
 * `pickBan` covers both map and hero pick-ban configuration (the map-veto
 * cutover onto the generic PickBanConfig engine, 2026-08-10) — one guided
 * editor, labelled "Pre-game Phase" rather than either catalog's name.
 */
const TAB_BAR: ReadonlyArray<{ key: TabKey; label: string }> = [
  { key: "overview", label: "Overview" },
  { key: "registration", label: "Registration" },
  { key: "teams", label: "Teams" },
  { key: "stages", label: "Stages" },
  { key: "matches", label: "Play & Results" },
  { key: "draft", label: "Draft" },
  { key: "pickBan", label: "Pre-game Phase" },
  // Label only, no icon: every other entry here is text, and lucide's `Link`
  // would also collide with the `next/link` import above.
  { key: "links", label: "Links" },
  { key: "settings", label: "Settings" }
];

// Trailing debounce for readiness invalidations (§3): bulk registration edits
// emit one balancer event per row — a burst must cost one readiness refetch,
// not N (same pattern as useBalancerRealtime's data-event debounce).
const READINESS_INVALIDATE_DEBOUNCE_MS = 400;

/**
 * Client shell of the tournament hub (§1.1): owns the permission gate, the
 * workspace header, the tab bar with route guards, the single
 * `useTournamentRealtime` mount and the shared queries. Query keys MUST stay
 * identical to the tab pages — realtime patch-in-cache and workspace
 * invalidation depend on them (see components/tournamentWorkspace.queryKeys.ts).
 */
export function TournamentHubShell({
  tournamentId,
  children
}: Readonly<{
  tournamentId: number;
  children: ReactNode;
}>) {
  const router = useRouter();
  const pathname = usePathname();
  const isValidTournamentId = Number.isFinite(tournamentId) && tournamentId > 0;
  const { canAccessPermission, isLoaded: permissionsLoaded, isSuperuser } = usePermissions();

  const basePath = `/admin/tournaments/${tournamentId}`;
  // Segment right after the id is the tab; deeper segments (future sub-routes
  // like registration/form) still resolve to their parent tab.
  const tabSegment = pathname.startsWith(basePath)
    ? (pathname.slice(basePath.length).split("/").find(Boolean) ?? "overview")
    : "overview";
  const activeTab: TabKey = isTabKey(tabSegment) ? tabSegment : "overview";

  const tournamentQuery = useHubTournamentQuery(tournamentId);

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

  const stagesQuery = useHubStagesQuery(tournamentId);
  // Pre-T5 the standings query was gated to the overview|matches tabs, but the
  // header shows the standings metric unconditionally — keep it always enabled.
  const standingsQuery = useHubStandingsQuery(tournamentId);

  const tournamentWorkspaceId = tournamentQuery.data?.workspace_id ?? null;
  // Align the workspace store with the tournament's workspace: workspace-scoped
  // catalogs (custom statuses, sub-roles) on the registration tab read the store,
  // and apiFetch injects the store workspace into every call (D25/D29).
  useSyncActiveWorkspace(tournamentWorkspaceId);
  // NOTE: no division-grid query here. It used to run on every hub page load
  // purely to feed three header props that were never read. The Settings tab
  // owns that query, where the grid picker actually uses it.

  // Living-checklist freshness (§3, G-O6): balancer + bracket events schedule
  // one debounced invalidation of the readiness aggregate. No polling (CG-O4).
  const queryClient = useQueryClient();
  const readinessTimerRef = useRef<number | undefined>(undefined);
  const scheduleReadinessInvalidate = useCallback(() => {
    window.clearTimeout(readinessTimerRef.current);
    readinessTimerRef.current = window.setTimeout(() => {
      void queryClient.invalidateQueries({
        queryKey: getTournamentWorkspaceQueryKeys(tournamentId).readiness
      });
    }, READINESS_INVALIDATE_DEBOUNCE_MS);
  }, [queryClient, tournamentId]);
  useEffect(() => () => window.clearTimeout(readinessTimerRef.current), []);

  // The one and only realtime mount of the hub — tab pages must not mount it.
  useTournamentRealtime({
    tournamentId: isValidTournamentId ? tournamentId : null,
    workspaceId: tournamentWorkspaceId,
    onUpdate: scheduleReadinessInvalidate
  });

  // Existing tournament-scoped balancer topic (assumption A4): registration /
  // pool / balance writes land here, not on the bracket topic.
  useRealtimeTopic(
    isValidTournamentId ? `tournament:${tournamentId}:balancer` : null,
    (event) => {
      if (event.event_type === "balancer.presence") return;
      scheduleReadinessInvalidate();
    }
  );

  // Subscription verdicts ride on every registration read (`subscription_outcome`
  // drives the admission grouping), so a background sweep or another admin's
  // re-check changes this page with no local mutation to hang an invalidation on.
  // Workspace-scoped, not tournament-scoped: an entitlement is
  // (workspace, user, provider) and one change is visible in every tournament.
  useRealtimeCoalescedRefetch(
    isValidTournamentId && tournamentWorkspaceId != null
      ? `workspace:${tournamentWorkspaceId}:subscriptions`
      : null,
    {
      minDelayMs: 0,
      onEvent: (_event, schedule) => schedule(),
      onFlush: () => {
        if (tournamentWorkspaceId == null) return;
        void queryClient.invalidateQueries({
          queryKey: tournamentQueryKeys.registrationsList(tournamentWorkspaceId, tournamentId)
        });
        scheduleReadinessInvalidate();
      }
    }
  );

  const tournament = tournamentQuery.data;
  const canUpdateTournament = canAccessPermission("tournament.update", tournamentWorkspaceId);
  const canDeleteTournament = canAccessPermission("tournament.delete", tournamentWorkspaceId);
  const canReadAnalytics = canAccessPermission("analytics.read", tournamentWorkspaceId);
  const canTeamRead = canAccessPermission("team.read", tournamentWorkspaceId);
  const canReadTournamentLink = canAccessPermission(
    "tournament_link.read",
    tournamentWorkspaceId
  );
  const canCreateTeam = canAccessPermission("team.create", tournamentWorkspaceId);
  const canUpdateTeam = canAccessPermission("team.update", tournamentWorkspaceId);
  const canDeleteTeam = canAccessPermission("team.delete", tournamentWorkspaceId);
  const canImportTeams = canAccessPermission("team.create", tournamentWorkspaceId);
  const canCreatePlayer = canAccessPermission("player.create", tournamentWorkspaceId);
  const canUpdatePlayer = canAccessPermission("player.update", tournamentWorkspaceId);
  const canDeletePlayer = canAccessPermission("player.delete", tournamentWorkspaceId);
  const canCreateEncounter = canAccessPermission("match.create", tournamentWorkspaceId);
  const canUpdateEncounter = canAccessPermission("match.update", tournamentWorkspaceId);
  const canDeleteEncounter = canAccessPermission("match.delete", tournamentWorkspaceId);
  const canSyncEncounters = canAccessPermission("challonge.update", tournamentWorkspaceId);
  const canUpdateStanding = canAccessPermission("standing.update", tournamentWorkspaceId);
  const canDeleteStanding = canAccessPermission("standing.delete", tournamentWorkspaceId);
  const canRecalculateStandings = canAccessPermission(
    "standing.update",
    tournamentWorkspaceId
  );

  const teamFormation: "balancer" | "draft" =
    tournament?.team_formation === "draft" ? "draft" : "balancer";
  const tabAccess = {
    canUpdateTournament,
    canUpdateEncounter,
    canTeamRead,
    canReadTournamentLink,
    teamFormation
  };
  const activeTabAllowed = allowedTab(activeTab, tabAccess);

  // Route guard (D2): a direct hit on a tab the caller may not open bounces
  // back to overview. Only decide once permissions and the tournament are in.
  useEffect(() => {
    if (!permissionsLoaded || !tournament) return;
    if (!activeTabAllowed) {
      router.replace(`${basePath}/overview`);
    }
  }, [permissionsLoaded, tournament, activeTabAllowed, basePath, router]);

  const teamsCount = teamsCountQuery.data ?? null;
  const encountersCount = encountersCountQuery.data ?? null;
  const standingsCount = standingsQuery.data?.length ?? null;

  if (tournamentQuery.isLoading || stagesQuery.isLoading || !permissionsLoaded) {
    return (
      // Mirrors the real shape: title bar, phase stepper, tab bar, tab body.
      <div className="space-y-4">
        <Skeleton className="h-16 w-full rounded-xl" />
        <Skeleton className="h-14 w-full rounded-xl" />
        <Skeleton className="h-9 w-full max-w-2xl rounded-lg" />
        <Skeleton className="h-72 w-full rounded-xl" />
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
      canRecalculateStandings,
      // Otherwise a caller granted only `tournament_link.read` sees
      // "Unauthorized" instead of the Links tab `allowedTab` just cleared.
      canReadTournamentLink
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
        canToggleFinished={canUpdateTournament && isSuperuser}
      />
      <Tabs value={activeTab} className="space-y-4">
        <TabsList className="h-auto flex-wrap justify-start">
          {TAB_BAR.filter((tab) => allowedTab(tab.key, tabAccess)).map((tab) => (
            <TabsTrigger key={tab.key} value={tab.key} asChild>
              <Link href={`${basePath}/${tab.key}`}>{tab.label}</Link>
            </TabsTrigger>
          ))}
        </TabsList>
        {activeTabAllowed ? children : null}
      </Tabs>
    </div>
  );
}
