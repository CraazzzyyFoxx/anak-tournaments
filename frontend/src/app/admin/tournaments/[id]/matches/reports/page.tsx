"use client";

import dynamic from "next/dynamic";
import { useParams } from "next/navigation";
import { usePermissions } from "@/hooks/usePermissions";
import { tabFallback, useHubTournamentQuery } from "../../hubQueries";

const EncounterReportsBrowser = dynamic(
  () =>
    import("@/components/admin/EncounterReportsBrowser").then((module) => ({
      default: module.EncounterReportsBrowser
    })),
  { loading: () => tabFallback }
);

export default function ReportsTabPage() {
  const params = useParams<{ id: string }>();
  const tournamentId = Number(params.id);
  const { canAccessPermission } = usePermissions();

  const tournamentQuery = useHubTournamentQuery(tournamentId);

  if (tournamentQuery.isLoading) {
    return tabFallback;
  }
  if (!tournamentQuery.data) {
    return null;
  }

  const workspaceId = tournamentQuery.data.workspace_id ?? null;
  return (
    <EncounterReportsBrowser
      tournamentId={tournamentId}
      workspaceId={workspaceId}
      canUpdateEncounter={canAccessPermission("match.update", workspaceId)}
    />
  );
}
