"use client";

import { useBalancerTournamentId } from "@/app/balancer/components/useBalancerTournamentId";
import SheetsFeedPage from "@/components/balancer/feed/SheetsFeedPage";

// D25 dual availability: this legacy route keeps rendering the shared Google
// Sheets feed builder (tournament resolved from the ?tournament query) until
// T14 replaces it with a permanent redirect to the hub registration sub-route.
export default function BalancerRegistrationsFeedPage() {
  const tournamentId = useBalancerTournamentId();

  return <SheetsFeedPage tournamentId={tournamentId} basePath="/balancer/registrations" />;
}
