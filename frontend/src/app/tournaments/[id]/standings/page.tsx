import React from "react";

import TournamentStandingsPage from "@/app/tournaments/[id]/pages/TournamentStandingsPage";

import { getTournament } from "../_data";

type TournamentStandingsRoutePageProps = {
  params: Promise<{ id: string }>;
};

export default async function TournamentStandingsRoutePage({
  params
}: TournamentStandingsRoutePageProps) {
  const resolvedParams = await params;
  const tournamentId = Number(resolvedParams.id);
  const tournament = await getTournament(tournamentId);

  return <TournamentStandingsPage tournament={tournament} />;
}
