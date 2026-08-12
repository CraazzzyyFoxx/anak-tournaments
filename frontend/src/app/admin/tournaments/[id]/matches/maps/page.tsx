"use client";

import dynamic from "next/dynamic";
import { useParams } from "next/navigation";
import { tabFallback, useHubTournamentQuery } from "../../hubQueries";

const ParsedMatchesBrowser = dynamic(
  () =>
    import("@/components/admin/ParsedMatchesBrowser").then((module) => ({
      default: module.ParsedMatchesBrowser
    })),
  { loading: () => tabFallback }
);

export default function MapsTabPage() {
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
    <ParsedMatchesBrowser
      tournamentId={tournamentId}
      workspaceId={tournamentQuery.data.workspace_id ?? null}
    />
  );
}
