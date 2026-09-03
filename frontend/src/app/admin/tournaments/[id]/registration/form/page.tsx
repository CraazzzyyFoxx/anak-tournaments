"use client";

import dynamic from "next/dynamic";
import { useParams } from "next/navigation";
import { tabFallback } from "../../hubQueries";

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
    />
  );
}
