"use client";

import dynamic from "next/dynamic";
import { useParams } from "next/navigation";
import { usePermissions } from "@/hooks/usePermissions";
import {
  tabFallback,
  useHubEncountersQuery,
  useHubStagesQuery,
  useHubTournamentQuery,
} from "../hubQueries";

const PickBanConfigsTab = dynamic(
  () => import("../components/PickBanConfigsTab").then((module) => ({ default: module.PickBanConfigsTab })),
  { loading: () => tabFallback },
);

export default function PickBanTabPage() {
  const params = useParams<{ id: string }>();
  const tournamentId = Number(params.id);
  const { canAccessPermission } = usePermissions();

  const tournamentQuery = useHubTournamentQuery(tournamentId);
  const stagesQuery = useHubStagesQuery(tournamentId);
  // Shares its key and its cache with the other hub tabs, so this is usually
  // already resolved. Deliberately not gated on below: the round picker
  // degrades to each stage's planned rounds while it is in flight rather than
  // holding the whole tab back for a list only the editor reads.
  const encountersQuery = useHubEncountersQuery(tournamentId);
  const workspaceId = tournamentQuery.data?.workspace_id ?? null;

  if (tournamentQuery.isLoading || stagesQuery.isLoading) {
    return tabFallback;
  }

  return (
    <PickBanConfigsTab
      tournamentId={tournamentId}
      stages={stagesQuery.data ?? []}
      encounters={encountersQuery.data?.results}
      canManage={canAccessPermission("match.update", workspaceId)}
    />
  );
}
