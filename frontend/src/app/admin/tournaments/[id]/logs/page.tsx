"use client";

import dynamic from "next/dynamic";
import { useParams } from "next/navigation";
import { usePermissions } from "@/hooks/usePermissions";
import { tabFallback, useHubEncountersQuery, useHubTournamentQuery } from "../hubQueries";

const TournamentLogsTab = dynamic(
  () =>
    import("../components/TournamentLogsTab").then((module) => ({
      default: module.TournamentLogsTab
    })),
  { loading: () => tabFallback }
);

export default function LogsTabPage() {
  const params = useParams<{ id: string }>();
  const tournamentId = Number(params.id);
  const { canAccessPermission } = usePermissions();

  const tournamentQuery = useHubTournamentQuery(tournamentId);
  const encountersQuery = useHubEncountersQuery(tournamentId);
  const workspaceId = tournamentQuery.data?.workspace_id ?? null;

  if (tournamentQuery.isLoading || encountersQuery.isLoading) {
    return tabFallback;
  }
  if (!tournamentQuery.data) {
    return null;
  }

  return (
    <TournamentLogsTab
      tournamentId={tournamentId}
      workspaceId={workspaceId}
      encounters={encountersQuery.data?.results ?? []}
      canUploadLogs={canAccessPermission("match.update", workspaceId)}
      enabled
    />
  );
}
