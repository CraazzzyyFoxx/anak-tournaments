"use client";

import dynamic from "next/dynamic";
import { useParams } from "next/navigation";

import { usePermissions } from "@/hooks/usePermissions";
import { tabFallback, useHubTournamentQuery } from "../hubQueries";

const TournamentLinksTab = dynamic(
  () =>
    import("../components/TournamentLinksTab").then((module) => ({
      default: module.TournamentLinksTab
    })),
  { loading: () => tabFallback }
);

export default function LinksTabPage() {
  const params = useParams<{ id: string }>();
  const tournamentId = Number(params.id);
  const { canAccessPermission } = usePermissions();

  const tournamentQuery = useHubTournamentQuery(tournamentId);
  const tournament = tournamentQuery.data;
  const workspaceId = tournament?.workspace_id ?? null;

  if (tournamentQuery.isLoading) {
    return tabFallback;
  }
  if (!tournament) {
    return null;
  }

  return (
    <TournamentLinksTab
      tournamentId={tournamentId}
      canCreate={canAccessPermission("tournament_link.create", workspaceId)}
      canUpdate={canAccessPermission("tournament_link.update", workspaceId)}
      canDelete={canAccessPermission("tournament_link.delete", workspaceId)}
      canRepollStreams={canAccessPermission("stream.update", workspaceId)}
    />
  );
}
