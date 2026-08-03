"use client";

import dynamic from "next/dynamic";
import { useParams } from "next/navigation";
import { tabFallback, useHubTournamentQuery } from "../../hubQueries";

const TournamentReportsTab = dynamic(
  () =>
    import("../../components/TournamentReportsTab").then((module) => ({
      default: module.TournamentReportsTab
    })),
  { loading: () => tabFallback }
);

export default function ReportsTabPage() {
  const params = useParams<{ id: string }>();
  const tournamentId = Number(params.id);

  const tournamentQuery = useHubTournamentQuery(tournamentId);

  if (tournamentQuery.isLoading) {
    return tabFallback;
  }
  if (!tournamentQuery.data) {
    return null;
  }

  return (
    <TournamentReportsTab
      tournamentId={tournamentId}
      workspaceId={tournamentQuery.data.workspace_id ?? null}
    />
  );
}
