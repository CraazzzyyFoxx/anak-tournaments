import React from "react";

import { getTournament, getTournamentStages } from "../_data";
import TournamentBracketPage from "./TournamentBracketPage";

type Props = {
  params: Promise<{ id: string }>;
};

export default async function BracketPage({ params }: Props) {
  const resolvedParams = await params;
  const tournamentId = Number(resolvedParams.id);
  const tournament = await getTournament(tournamentId);
  const stages = await getTournamentStages(tournamentId);

  return <TournamentBracketPage tournament={tournament} stages={stages} />;
}
