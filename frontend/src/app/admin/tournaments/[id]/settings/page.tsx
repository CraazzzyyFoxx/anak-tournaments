"use client";

import dynamic from "next/dynamic";
import { useParams } from "next/navigation";
import { usePermissions } from "@/hooks/usePermissions";
import {
  flattenDivisionGridVersions,
  tabFallback,
  useHubDivisionGridsQuery,
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
  const { canAccessPermission } = usePermissions();

  const tournamentQuery = useHubTournamentQuery(tournamentId);
  const workspaceId = tournamentQuery.data?.workspace_id ?? null;
  const divisionGridsQuery = useHubDivisionGridsQuery(tournamentId, workspaceId);

  const tournament = tournamentQuery.data;

  if (tournamentQuery.isLoading) {
    return tabFallback;
  }
  if (!tournament) {
    return null;
  }

  return (
    <TournamentSettingsTab
      tournament={tournament}
      tournamentId={tournamentId}
      divisionGridVersions={flattenDivisionGridVersions(divisionGridsQuery.data)}
      divisionGridLoading={divisionGridsQuery.isLoading}
      canDeleteTournament={canAccessPermission("tournament.delete", workspaceId)}
    />
  );
}
