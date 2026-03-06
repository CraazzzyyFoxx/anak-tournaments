import React from "react";

import TournamentEncountersPage from "@/app/tournaments/[id]/pages/TournamentEncountersPage";

import { getTournament } from "../_data";

type TournamentMatchesPageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{
    page?: string;
    search?: string;
  }>;
};

export default async function TournamentMatchesPage({
  params,
  searchParams
}: TournamentMatchesPageProps) {
  const resolvedParams = await params;
  const resolvedSearchParams = await searchParams;

  const tournamentId = Number(resolvedParams.id);
  const tournament = await getTournament(tournamentId);

  const page = Number.parseInt(resolvedSearchParams.page ?? "1", 10) || 1;
  const search = resolvedSearchParams.search ?? "";

  return <TournamentEncountersPage tournament={tournament} page={page} search={search} />;
}
