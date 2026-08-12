"use client";

import dynamic from "next/dynamic";
import { useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { usePermissions } from "@/hooks/usePermissions";
import adminService from "@/services/admin.service";
import { getTournamentWorkspaceQueryKeys } from "../components/tournamentWorkspace.queryKeys";
import { hasChallongeSource } from "@/components/admin/tournament-checklist";
import {
  flattenDivisionGridVersions,
  tabFallback,
  useHubDivisionGridsQuery,
  useHubStagesQuery,
  useHubTournamentQuery
} from "../hubQueries";

const TournamentSettingsTab = dynamic(
  () =>
    import("../components/TournamentSettingsTab").then((module) => ({
      default: module.TournamentSettingsTab
    })),
  { loading: () => tabFallback }
);

export default function SettingsTabPage() {
  const params = useParams<{ id: string }>();
  const tournamentId = Number(params.id);
  const isValidTournamentId = Number.isFinite(tournamentId) && tournamentId > 0;
  const { canAccessPermission } = usePermissions();

  const tournamentQuery = useHubTournamentQuery(tournamentId);
  const workspaceId = tournamentQuery.data?.workspace_id ?? null;
  const divisionGridsQuery = useHubDivisionGridsQuery(tournamentId, workspaceId);
  const stagesQuery = useHubStagesQuery(tournamentId);
  const discordChannelQuery = useQuery({
    queryKey: getTournamentWorkspaceQueryKeys(tournamentId).discordChannel,
    queryFn: () => adminService.getDiscordChannel(tournamentId),
    enabled: isValidTournamentId
  });

  const tournament = tournamentQuery.data;

  if (tournamentQuery.isLoading) {
    return tabFallback;
  }
  if (!tournament) {
    return null;
  }

  const canUpdateTournament = canAccessPermission("tournament.update", workspaceId);

  return (
    <TournamentSettingsTab
      tournament={tournament}
      tournamentId={tournamentId}
      divisionGridVersions={flattenDivisionGridVersions(divisionGridsQuery.data)}
      divisionGridLoading={divisionGridsQuery.isLoading}
      canDeleteTournament={canAccessPermission("tournament.delete", workspaceId)}
      canUpdateTournament={canUpdateTournament}
      hasChallongeSource={hasChallongeSource(tournament, stagesQuery.data ?? [])}
      discordChannel={discordChannelQuery.data}
      discordChannelLoading={discordChannelQuery.isLoading}
    />
  );
}
