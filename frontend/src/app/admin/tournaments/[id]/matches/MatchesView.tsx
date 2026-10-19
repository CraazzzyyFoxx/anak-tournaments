"use client";

import type { ReactNode } from "react";
import { useTranslations } from "next-intl";

import { PageStateCard } from "@/components/ui/page-state-card";
import { usePermissions } from "@/hooks/usePermissions";
import { tabError, tabFallback, useHubTournamentQuery } from "../hubQueries";

export interface MatchesViewScope {
  workspaceId: number | null;
  tournamentName: string;
  /** The tournament's own game (owner scope). */
  discipline: string;
}

/**
 * The `match.read` gate the Matches views share — and the Bracket tab's
 * Standings and Lobbies views, which read the same match results.
 *
 * The gate lives here rather than in `layout.tsx` because the layout is
 * navigation: the sub-tab bar has no tournament of its own to authorize
 * against, and the pre-redesign version bounced an unpermitted visitor to a
 * sibling sub-tab that needed the very same grant — a redirect loop dressed as
 * a guard.
 *
 * The tournament comes from the hub's shared query, so this costs no request
 * beyond what the shell already holds.
 */
export function MatchesView({
  tournamentId,
  children
}: Readonly<{
  tournamentId: number;
  children: (scope: MatchesViewScope) => ReactNode;
}>) {
  const t = useTranslations("adminTournament.matches");
  const { canAccessPermission, isLoaded } = usePermissions();
  const tournamentQuery = useHubTournamentQuery(tournamentId);

  if (tournamentQuery.isLoading || !isLoaded) return tabFallback;

  const tournament = tournamentQuery.data;
  if (!tournament) return tabError(() => void tournamentQuery.refetch());

  const workspaceId = tournament.workspace_id ?? null;
  if (!canAccessPermission("match.read", workspaceId)) {
    return (
      <PageStateCard
        state="error"
        title={t("unauthorized")}
        description={t("unauthorizedDescription")}
      />
    );
  }

  return <>{children({ workspaceId, tournamentName: tournament.name, discipline: tournament.discipline })}</>;
}
