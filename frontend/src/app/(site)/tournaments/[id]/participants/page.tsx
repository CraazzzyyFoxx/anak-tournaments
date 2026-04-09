import React from "react";

import TournamentParticipantsPage from "@/app/(site)/tournaments/[id]/pages/TournamentParticipantsPage";

import { getTournament } from "../_data";

type Props = {
  params: Promise<{ id: string }>;
};

export default async function TournamentParticipantsRoutePage({ params }: Props) {
  const resolvedParams = await params;
  const tournamentId = Number(resolvedParams.id);
  const tournament = await getTournament(tournamentId);

  return <TournamentParticipantsPage tournament={tournament} />;
}
