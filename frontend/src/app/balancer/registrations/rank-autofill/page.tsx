"use client";

import { useBalancerTournamentId } from "@/app/balancer/components/useBalancerTournamentId";
import RankAutofillPage from "@/components/balancer/rank-autofill/RankAutofillPage";

// D25 dual availability: this legacy route keeps rendering the shared
// rank-autofill tool (tournament resolved from the ?tournament query) until
// T14 replaces it with a permanent redirect to the hub registration sub-route.
export default function BalancerRankAutofillPage() {
  const tournamentId = useBalancerTournamentId();

  return <RankAutofillPage tournamentId={tournamentId} basePath="/balancer/registrations" />;
}
