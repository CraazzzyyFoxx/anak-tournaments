"use client";

import dynamic from "next/dynamic";
import { useParams } from "next/navigation";
import { usePermissions } from "@/hooks/usePermissions";
import { tabFallback, useHubTournamentQuery } from "../hubQueries";

const DraftSessionDashboard = dynamic(
  () =>
    import("../components/DraftSessionDashboard").then((module) => ({
      default: module.DraftSessionDashboard
    })),
  { loading: () => tabFallback }
);

export default function DraftTabPage() {
  const params = useParams<{ id: string }>();
  const tournamentId = Number(params.id);
  const { canAccessPermission } = usePermissions();

  // The shell redirects non-draft tournaments away; only permission wiring here.
  const tournamentQuery = useHubTournamentQuery(tournamentId);
  const workspaceId = tournamentQuery.data?.workspace_id ?? null;

  if (tournamentQuery.isLoading) {
    return tabFallback;
  }

  return (
    <DraftSessionDashboard
      tournamentId={tournamentId}
      canManage={canAccessPermission("team.import", workspaceId)}
    />
  );
}
