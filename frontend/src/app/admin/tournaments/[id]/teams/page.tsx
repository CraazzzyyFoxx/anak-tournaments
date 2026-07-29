"use client";

import dynamic from "next/dynamic";
import { useParams } from "next/navigation";
import { usePermissions } from "@/hooks/usePermissions";
import {
  hasChallongeSource,
  tabFallback,
  useHubStagesQuery,
  useHubTeamsQuery,
  useHubTournamentQuery
} from "../hubQueries";

const TournamentTeamsTab = dynamic(
  () =>
    import("../components/TournamentTeamsTab").then((module) => ({
      default: module.TournamentTeamsTab
    })),
  { loading: () => tabFallback }
);

export default function TeamsTabPage() {
  const params = useParams<{ id: string }>();
  const tournamentId = Number(params.id);
  const { canAccessPermission } = usePermissions();

  const tournamentQuery = useHubTournamentQuery(tournamentId);
  const stagesQuery = useHubStagesQuery(tournamentId);
  const teamsQuery = useHubTeamsQuery(tournamentId);

  const tournament = tournamentQuery.data;
  const stages = stagesQuery.data ?? [];
  const workspaceId = tournament?.workspace_id ?? null;

  if (tournamentQuery.isLoading || stagesQuery.isLoading || teamsQuery.isLoading) {
    return tabFallback;
  }
  if (!tournament) {
    return null;
  }

  return (
    <TournamentTeamsTab
      tournamentId={tournamentId}
      workspaceId={workspaceId}
      teams={teamsQuery.data?.results ?? []}
      stagesCount={stages.length}
      hasChallongeSource={hasChallongeSource(tournament, stages)}
      canCreateTeam={canAccessPermission("team.create", workspaceId)}
      canUpdateTeam={canAccessPermission("team.update", workspaceId)}
      canDeleteTeam={canAccessPermission("team.delete", workspaceId)}
      canImportTeams={canAccessPermission("team.import", workspaceId)}
      canCreatePlayer={canAccessPermission("player.create", workspaceId)}
      canUpdatePlayer={canAccessPermission("player.update", workspaceId)}
      canDeletePlayer={canAccessPermission("player.delete", workspaceId)}
    />
  );
}
