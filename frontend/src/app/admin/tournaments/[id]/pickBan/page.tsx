"use client";

import dynamic from "next/dynamic";
import { useParams } from "next/navigation";
import { usePermissions } from "@/hooks/usePermissions";
import { tabFallback, useHubTournamentQuery } from "../hubQueries";

const PickBanConfigsTab = dynamic(
  () => import("../components/PickBanConfigsTab").then((module) => ({ default: module.PickBanConfigsTab })),
  { loading: () => tabFallback },
);

export default function PickBanTabPage() {
  const params = useParams<{ id: string }>();
  const tournamentId = Number(params.id);
  const { canAccessPermission } = usePermissions();

  const tournamentQuery = useHubTournamentQuery(tournamentId);
  const workspaceId = tournamentQuery.data?.workspace_id ?? null;

  if (tournamentQuery.isLoading) {
    return tabFallback;
  }

  return (
    <PickBanConfigsTab tournamentId={tournamentId} canManage={canAccessPermission("match.update", workspaceId)} />
  );
}
