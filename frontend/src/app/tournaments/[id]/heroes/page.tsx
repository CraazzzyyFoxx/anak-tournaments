import React from "react";

import TournamentHeroPlaytimePage from "@/app/tournaments/[id]/pages/TournamentHeroPlaytimePage";

import { getTournament } from "../_data";

type TournamentHeroesPageProps = {
  params: Promise<{ id: string }>;
};

export default async function TournamentHeroesPage({ params }: TournamentHeroesPageProps) {
  const resolvedParams = await params;
  const tournamentId = Number(resolvedParams.id);
  const tournament = await getTournament(tournamentId);

  return <TournamentHeroPlaytimePage tournament={tournament} />;
}
