"use client";

import dynamic from "next/dynamic";
import { useParams } from "next/navigation";
import { usePermissions } from "@/hooks/usePermissions";
import { hasChallongeSource } from "@/components/admin/tournament-checklist";
import {
  tabError,
  tabFallback,
  useHubStagesQuery,
  useHubTeamsQuery,
  useHubTournamentQuery
} from "../../hubQueries";

const TournamentTeamsTab = dynamic(
  () =>
    import("../../components/TournamentTeamsTab").then((module) => ({
      default: module.TournamentTeamsTab
    })),
  { loading: () => tabFallback }
);

export default function TeamsRosterPage() {
  const params = useParams<{ id: string }>();
  const tournamentId = Number(params.id);
  const { canAccessPermission } = usePermissions();

  const tournamentQuery = useHubTournamentQuery(tournamentId);
  const stagesQuery = useHubStagesQuery(tournamentId);
  const teamsQuery = useHubTeamsQuery(tournamentId);

  const tournament = tournamentQuery.data;

  if (tournamentQuery.isLoading || stagesQuery.isLoading || teamsQuery.isLoading) {
    return tabFallback;
  }
  if (!tournament) {
    return tabError(tournamentQuery.refetch);
  }
  if (teamsQuery.isError) {
    return tabError(teamsQuery.refetch);
  }

  const workspaceId = tournament.workspace_id;
  const canManageTeams = (
    ["team.create", "team.update", "team.delete", "player.create", "player.update", "player.delete"] as const
  ).some((permission) => canAccessPermission(permission, workspaceId));

  return (
    <TournamentTeamsTab
      tournamentId={tournamentId}
      teams={teamsQuery.data?.results ?? []}
      hasChallongeSource={hasChallongeSource(tournament, stagesQuery.data ?? [])}
      canImportTeams={canAccessPermission("team.create", workspaceId)}
      canManageTeams={canManageTeams}
    />
  );
}
