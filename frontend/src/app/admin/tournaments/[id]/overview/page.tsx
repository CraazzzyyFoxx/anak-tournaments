"use client";

import dynamic from "next/dynamic";
import { useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { usePermissions } from "@/hooks/usePermissions";
import adminService from "@/services/admin.service";
import { getTournamentWorkspaceQueryKeys } from "../components/tournamentWorkspace.queryKeys";
import {
  hasChallongeSource,
  tabFallback,
  useHubStagesQuery,
  useHubTournamentQuery
} from "../hubQueries";

const TournamentSetupTab = dynamic(
  () =>
    import("../components/TournamentSetupTab").then((module) => ({
      default: module.TournamentSetupTab
    })),
  { loading: () => tabFallback }
);

export default function OverviewTabPage() {
  const params = useParams<{ id: string }>();
  const tournamentId = Number(params.id);
  const { canAccessPermission } = usePermissions();

  const tournamentQuery = useHubTournamentQuery(tournamentId);
  const stagesQuery = useHubStagesQuery(tournamentId);
  const discordChannelQuery = useQuery({
    queryKey: getTournamentWorkspaceQueryKeys(tournamentId).discordChannel,
    queryFn: () => adminService.getDiscordChannel(tournamentId),
    enabled: Number.isFinite(tournamentId) && tournamentId > 0
  });

  const tournament = tournamentQuery.data;
  const stages = stagesQuery.data ?? [];

  if (tournamentQuery.isLoading || stagesQuery.isLoading) {
    return tabFallback;
  }
  if (!tournament) {
    return null;
  }

  return (
    <TournamentSetupTab
      tournamentId={tournamentId}
      tournament={tournament}
      stages={stages}
      hasChallongeSource={hasChallongeSource(tournament, stages)}
      canUpdateTournament={canAccessPermission("tournament.update", tournament.workspace_id)}
      discordChannel={discordChannelQuery.data}
      discordChannelLoading={discordChannelQuery.isLoading}
    />
  );
}
