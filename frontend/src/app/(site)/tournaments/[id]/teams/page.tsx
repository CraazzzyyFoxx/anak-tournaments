"use client";

import { useParams } from "next/navigation";

import TournamentTeamsPage from "@/app/(site)/tournaments/[id]/_views/TournamentTeamsPage";

export default function TournamentTeamsRoutePage() {
  const params = useParams<{ id: string }>();
  return <TournamentTeamsPage key={params.id} tournamentId={Number(params.id)} />;
}
