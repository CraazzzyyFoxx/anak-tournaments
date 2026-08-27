import type { QueryClient } from "@tanstack/react-query";

import { getTournamentWorkspaceQueryKeys } from "@/app/admin/tournaments/[id]/components/tournamentWorkspace.queryKeys";
import { tournamentQueryKeys } from "@/lib/tournament-query-keys";

// bracket_changed/results_changed/structure_changed form a strict severity
// chain — each plan is a superset of the weaker one's (see
// strongerTournamentReason). registration_changed's plan overlaps them only on
// the tournament detail key and is otherwise disjoint, so it is kept out of
// that total order and carried as its own independent signal.
export type BracketFamilyReason = "bracket_changed" | "results_changed" | "structure_changed";

export type TournamentChangedReason = BracketFamilyReason | "registration_changed";

const TOURNAMENT_REASON_RANK: Record<BracketFamilyReason, number> = {
  bracket_changed: 0,
  results_changed: 1,
  structure_changed: 2,
};

/**
 * Pick the broader of two tournament realtime reasons. Each reason's update plan
 * is a superset of the weaker one's (structure ⊇ results ⊇ bracket), so applying
 * the strongest reason seen within a coalescing window covers every reason it
 * coalesced into one refetch.
 */
export function strongerTournamentReason(
  current: BracketFamilyReason | null,
  next: BracketFamilyReason,
): BracketFamilyReason {
  if (current === null) {
    return next;
  }
  return TOURNAMENT_REASON_RANK[current] >= TOURNAMENT_REASON_RANK[next] ? current : next;
}

type TournamentRealtimeUpdatePlan = {
  workspaceScope: "bracket" | "results" | "full" | "registration";
  queryKeys: readonly (readonly unknown[])[];
  shouldRefreshRoute: boolean;
};

export { type Coalescer, type CoalescerClock, createLeadingCoalescer, createTrailingCoalescer } from "@/lib/realtime-coalesce";

function getResultQueryPrefixes(
  tournamentId: number,
  detailRef: string | number,
): readonly (readonly unknown[])[] {
  return [
    tournamentQueryKeys.detail(detailRef),
    tournamentQueryKeys.heroPlaytime(tournamentId),
    tournamentQueryKeys.standings(tournamentId),
    tournamentQueryKeys.encounters(tournamentId),
  ];
}

function getParticipantQueryPrefixes(
  tournamentId: number,
  workspaceId: number | null | undefined,
): readonly (readonly unknown[])[] {
  if (workspaceId == null) {
    return [];
  }

  return [
    tournamentQueryKeys.registration(workspaceId, tournamentId),
    tournamentQueryKeys.registrationsList(workspaceId, tournamentId),
    tournamentQueryKeys.registrationForm(workspaceId, tournamentId),
  ];
}

export function getTournamentRealtimeUpdatePlan(
  tournamentId: number,
  workspaceId: number | null | undefined,
  reason: TournamentChangedReason,
  // The public overview query stays keyed by the URL ref (slug/legacy id) for
  // its whole lifecycle -- see tournamentQueryKeys.detail. Callers outside the
  // public tournament page (admin) have no such ref, so it defaults to the
  // numeric id, which is exactly what they key by anyway.
  detailRef: string | number = tournamentId,
): TournamentRealtimeUpdatePlan {
  if (reason === "bracket_changed") {
    return {
      workspaceScope: "bracket",
      queryKeys: [tournamentQueryKeys.encounters(tournamentId)],
      shouldRefreshRoute: false,
    };
  }

  if (reason === "registration_changed") {
    return {
      workspaceScope: "registration",
      // The tournament detail read embeds live participants_count/
      // registrations_count, which change on every registration write — both
      // server layers drop it on this reason for that reason
      // (cache_invalidation.py::tournament_cache_patterns,
      // respcache.go::reasonPatterns), and TournamentClientLayout renders those
      // counts straight off this key.
      queryKeys: [
        tournamentQueryKeys.detail(detailRef),
        ...getParticipantQueryPrefixes(tournamentId, workspaceId),
      ],
      shouldRefreshRoute: false,
    };
  }

  const resultQueryPrefixes = getResultQueryPrefixes(tournamentId, detailRef);
  if (reason === "results_changed") {
    return {
      workspaceScope: "results",
      queryKeys: resultQueryPrefixes,
      shouldRefreshRoute: false,
    };
  }

  return {
    workspaceScope: "full",
    queryKeys: [
      ...resultQueryPrefixes,
      tournamentQueryKeys.teams(tournamentId),
      ...getParticipantQueryPrefixes(tournamentId, workspaceId),
    ],
    shouldRefreshRoute: true,
  };
}

export function getTournamentRealtimeCatchUpPlan(
  tournamentId: number,
  workspaceId: number | null | undefined,
  detailRef: string | number = tournamentId,
): readonly (readonly unknown[])[] {
  return [
    tournamentQueryKeys.detail(detailRef),
    tournamentQueryKeys.teams(tournamentId),
    tournamentQueryKeys.heroPlaytime(tournamentId),
    tournamentQueryKeys.standings(tournamentId),
    tournamentQueryKeys.encounters(tournamentId),
    ...getParticipantQueryPrefixes(tournamentId, workspaceId),
  ];
}

function invalidateQueryPrefixes(
  queryClient: QueryClient,
  queryKeys: readonly (readonly unknown[])[],
): void {
  for (const queryKey of queryKeys) {
    void queryClient.invalidateQueries({ queryKey });
  }
}

function invalidateAdminTournamentQueries(
  queryClient: QueryClient,
  tournamentId: number,
  scope: TournamentRealtimeUpdatePlan["workspaceScope"],
): void {
  const keys = getTournamentWorkspaceQueryKeys(tournamentId);

  if (scope === "bracket") {
    void queryClient.invalidateQueries({ queryKey: keys.encounters });
    return;
  }

  if (scope === "registration") {
    // The admin metadata query is backed by the same tournament read as
    // tournamentQueryKeys.detail and embeds the same live participants_count/
    // registrations_count, so a registration write stales it too.
    void queryClient.invalidateQueries({ queryKey: keys.tournament, exact: true });
    // Registration/participants keys are already invalidated via
    // getParticipantQueryPrefixes above. The stages/standings/encounters/teams
    // cascade below is deliberately skipped: a registration write changes no
    // encounter, standing, or team row.
    return;
  }

  // The metadata key is a parent of the admin workspace collections. Keep it
  // exact so each active child query is invalidated once through its own prefix.
  void queryClient.invalidateQueries({ queryKey: keys.tournament, exact: true });
  void queryClient.invalidateQueries({ queryKey: keys.stages });
  void queryClient.invalidateQueries({ queryKey: keys.standings });
  void queryClient.invalidateQueries({ queryKey: keys.encounters });
  void queryClient.invalidateQueries({ queryKey: keys.standingsTable });

  if (scope === "results") {
    void queryClient.invalidateQueries({ queryKey: keys.logHistory });
    return;
  }

  void queryClient.invalidateQueries({ queryKey: keys.teams });
}

export function applyTournamentRealtimeUpdate(
  queryClient: QueryClient,
  tournamentId: number,
  workspaceId: number | null | undefined,
  reason: TournamentChangedReason,
  onStructureChanged?: () => void,
  detailRef: string | number = tournamentId,
): void {
  const plan = getTournamentRealtimeUpdatePlan(tournamentId, workspaceId, reason, detailRef);
  invalidateQueryPrefixes(queryClient, plan.queryKeys);
  invalidateAdminTournamentQueries(queryClient, tournamentId, plan.workspaceScope);

  if (plan.shouldRefreshRoute) {
    onStructureChanged?.();
  }
}

export function applyTournamentRealtimeCatchUp(
  queryClient: QueryClient,
  tournamentId: number,
  workspaceId: number | null | undefined,
  detailRef: string | number = tournamentId,
): void {
  invalidateQueryPrefixes(
    queryClient,
    getTournamentRealtimeCatchUpPlan(tournamentId, workspaceId, detailRef),
  );
}
