"use client";

import dynamic from "next/dynamic";
import { useParams } from "next/navigation";
import { tabFallback } from "../../hubQueries";

// D25: the form builder lives in a neutral place and is rendered by both this
// hub sub-route (tournament from the path) and the legacy balancer route
// (tournament from the query) until T14 retires the latter.
const RegistrationFormBuilder = dynamic(
  () => import("@/components/balancer/form/RegistrationFormBuilder"),
  { loading: () => tabFallback }
);

export default function RegistrationFormSubRoutePage() {
  const params = useParams<{ id: string }>();
  const tournamentId = Number(params.id);

  return (
    <RegistrationFormBuilder
      tournamentId={Number.isFinite(tournamentId) && tournamentId > 0 ? tournamentId : null}
      basePath={`/admin/tournaments/${params.id}/registration`}
    />
  );
}
