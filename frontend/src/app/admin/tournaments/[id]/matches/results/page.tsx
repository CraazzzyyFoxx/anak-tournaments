"use client";

import dynamic from "next/dynamic";
import { useParams } from "next/navigation";
import { usePermissions } from "@/hooks/usePermissions";
import { hasChallongeSource } from "@/components/admin/tournament-checklist";
import {
  tabFallback,
  useHubEncountersQuery,
  useHubStagesQuery,
  useHubStandingsQuery,
  useHubTeamsQuery,
  useHubTournamentQuery
} from "../../hubQueries";

const TournamentMatchesTab = dynamic(
  () =>
    import("../../components/TournamentMatchesTab").then((module) => ({
      default: module.TournamentMatchesTab
    })),
  { loading: () => tabFallback }
);

export default function MatchesTabPage() {
  const params = useParams<{ id: string }>();
  const tournamentId = Number(params.id);
  const { canAccessPermission } = usePermissions();

  const tournamentQuery = useHubTournamentQuery(tournamentId);
  const stagesQuery = useHubStagesQuery(tournamentId);
  const teamsQuery = useHubTeamsQuery(tournamentId);
  const standingsQuery = useHubStandingsQuery(tournamentId);
  const encountersQuery = useHubEncountersQuery(tournamentId);

  const tournament = tournamentQuery.data;
  const stages = stagesQuery.data ?? [];
  const workspaceId = tournament?.workspace_id ?? null;

  if (
    tournamentQuery.isLoading ||
    stagesQuery.isLoading ||
    teamsQuery.isLoading ||
    standingsQuery.isLoading ||
    encountersQuery.isLoading
  ) {
    return tabFallback;
  }
  if (!tournament) {
    return null;
  }

  return (
    <TournamentMatchesTab
      tournamentId={tournamentId}
      teams={teamsQuery.data?.results ?? []}
      stages={stages}
      encounters={encountersQuery.data?.results ?? []}
      standings={standingsQuery.data ?? []}
      hasChallongeSource={hasChallongeSource(tournament, stages)}
      canCreateEncounter={canAccessPermission("match.create", workspaceId)}
      canUpdateEncounter={canAccessPermission("match.update", workspaceId)}
      canDeleteEncounter={canAccessPermission("match.delete", workspaceId)}
      // Encounter sync hits the Challonge import endpoint, so gate on the Challonge permission.
      canSyncEncounters={canAccessPermission("challonge.update", workspaceId)}
      canUpdateStanding={canAccessPermission("standing.update", workspaceId)}
      canDeleteStanding={canAccessPermission("standing.delete", workspaceId)}
      canRecalculateStandings={canAccessPermission("standing.update", workspaceId)}
    />
  );
}
