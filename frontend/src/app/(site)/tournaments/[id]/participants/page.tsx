"use client";

import { useParams } from "next/navigation";

import TournamentParticipantsPage from "@/app/(site)/tournaments/[id]/_views/TournamentParticipantsPage";

export default function TournamentParticipantsRoutePage() {
  const params = useParams<{ id: string }>();
  return <TournamentParticipantsPage key={params.id} tournamentId={Number(params.id)} />;
}
