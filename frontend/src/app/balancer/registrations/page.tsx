"use client";

import { useBalancerTournamentId } from "@/app/balancer/components/useBalancerTournamentId";
import RegistrationsTable from "@/components/balancer/registrations/RegistrationsTable";

// D25 dual availability: this legacy route keeps rendering the shared table
// (tournament resolved from the ?tournament query) until T14 replaces it with
// a permanent redirect to the hub registration tab.
export default function BalancerRegistrationsPage() {
  const tournamentId = useBalancerTournamentId();

  return <RegistrationsTable tournamentId={tournamentId} basePath="/balancer/registrations" />;
}
