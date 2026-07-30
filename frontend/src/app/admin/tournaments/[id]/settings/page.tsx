"use client";

import dynamic from "next/dynamic";
import { useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { usePermissions } from "@/hooks/usePermissions";
import adminService from "@/services/admin.service";
import { getTournamentWorkspaceQueryKeys } from "../components/tournamentWorkspace.queryKeys";
import {
  flattenDivisionGridVersions,
  hasChallongeSource,
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

const TournamentIntegrationsPanel = dynamic(
  () =>
    import("../components/TournamentIntegrationsPanel").then((module) => ({
      default: module.TournamentIntegrationsPanel
    })),
  { loading: () => null }
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
    <div className="flex flex-col gap-4">
      <TournamentSettingsTab
        tournament={tournament}
        tournamentId={tournamentId}
        divisionGridVersions={flattenDivisionGridVersions(divisionGridsQuery.data)}
        divisionGridLoading={divisionGridsQuery.isLoading}
        canDeleteTournament={canAccessPermission("tournament.delete", workspaceId)}
      />
      {/* Sibling of the settings form, never a child: these controls fire their
          own mutations and would submit the form otherwise. */}
      <TournamentIntegrationsPanel
        tournamentId={tournamentId}
        tournament={tournament}
        hasChallongeSource={hasChallongeSource(tournament, stagesQuery.data ?? [])}
        canUpdateTournament={canUpdateTournament}
        discordChannel={discordChannelQuery.data}
        discordChannelLoading={discordChannelQuery.isLoading}
      />
    </div>
  );
}
