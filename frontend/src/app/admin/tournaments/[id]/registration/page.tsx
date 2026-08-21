"use client";

import dynamic from "next/dynamic";
import { useParams } from "next/navigation";
import { RegistrationTeamsCard } from "../components/RegistrationTeamsCard";
import { tabFallback, useHubTournamentQuery } from "../hubQueries";

// D25: the registrations table lives in a neutral place and is rendered by both
// the hub tab (tournament from the path) and the legacy balancer route
// (tournament from the query) until T14 retires the latter.
const RegistrationsTable = dynamic(
  () => import("@/components/balancer/registrations/RegistrationsTable"),
  { loading: () => tabFallback }
);

export default function RegistrationTabPage() {
  const params = useParams<{ id: string }>();
  const tournamentId = Number(params.id);
  const validTournamentId =
    Number.isFinite(tournamentId) && tournamentId > 0 ? tournamentId : null;

  // Already in cache — the shell runs the same query under the same key.
  const { data: tournament } = useHubTournamentQuery(tournamentId);
  const workspaceId = tournament?.workspace_id ?? null;
  // Only a tournament that forms its teams by registration has registered teams;
  // for balancer/draft formation the card would always be empty.
  const showRegistrationTeams =
    validTournamentId != null &&
    workspaceId != null &&
    tournament?.team_formation === "registration";

  return (
    <div className="space-y-4">
      {showRegistrationTeams && (
        <RegistrationTeamsCard tournamentId={validTournamentId} workspaceId={workspaceId} />
      )}
      <RegistrationsTable
        tournamentId={validTournamentId}
        basePath={`/admin/tournaments/${params.id}/registration`}
      />
    </div>
  );
}
