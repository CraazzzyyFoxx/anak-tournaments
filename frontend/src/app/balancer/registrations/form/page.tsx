"use client";

import { useBalancerTournamentId } from "@/app/balancer/components/useBalancerTournamentId";
import RegistrationFormBuilder from "@/components/balancer/form/RegistrationFormBuilder";

// D25 dual availability: this legacy route keeps rendering the shared form
// builder (tournament resolved from the ?tournament query) until T14 replaces
// it with a permanent redirect to the hub registration sub-route.
export default function BalancerRegistrationFormPage() {
  const tournamentId = useBalancerTournamentId();

  return <RegistrationFormBuilder tournamentId={tournamentId} basePath="/balancer/registrations" />;
}
