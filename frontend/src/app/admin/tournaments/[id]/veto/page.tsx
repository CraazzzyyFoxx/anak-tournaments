"use client";

import dynamic from "next/dynamic";
import { useParams } from "next/navigation";
import { usePermissions } from "@/hooks/usePermissions";
import { tabFallback, useHubStagesQuery, useHubTournamentQuery } from "../hubQueries";

const TournamentMapVetoTab = dynamic(
  () =>
    import("../components/TournamentMapVetoTab").then((module) => ({
      default: module.TournamentMapVetoTab
    })),
  { loading: () => tabFallback }
);

export default function VetoTabPage() {
  const params = useParams<{ id: string }>();
  const tournamentId = Number(params.id);
  const { canAccessPermission } = usePermissions();

  const tournamentQuery = useHubTournamentQuery(tournamentId);
  const stagesQuery = useHubStagesQuery(tournamentId);
  const workspaceId = tournamentQuery.data?.workspace_id ?? null;

  if (tournamentQuery.isLoading || stagesQuery.isLoading) {
    return tabFallback;
  }

  return (
    <TournamentMapVetoTab
      tournamentId={tournamentId}
      stages={stagesQuery.data ?? []}
      canManage={canAccessPermission("match.update", workspaceId)}
    />
  );
}
