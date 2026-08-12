"use client";

import dynamic from "next/dynamic";
import { useParams } from "next/navigation";
import { tabFallback } from "../hubQueries";

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

  return (
    <RegistrationsTable
      tournamentId={Number.isFinite(tournamentId) && tournamentId > 0 ? tournamentId : null}
      basePath={`/admin/tournaments/${params.id}/registration`}
    />
  );
}
