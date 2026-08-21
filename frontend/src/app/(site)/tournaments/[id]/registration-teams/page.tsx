"use client";

import { useParams } from "next/navigation";

import TournamentRegistrationTeamsPage from "@/app/(site)/tournaments/[id]/_views/TournamentRegistrationTeamsPage";

export default function TournamentRegistrationTeamsRoutePage() {
  const params = useParams<{ id: string }>();
  return <TournamentRegistrationTeamsPage key={params.id} tournamentId={Number(params.id)} />;
}
