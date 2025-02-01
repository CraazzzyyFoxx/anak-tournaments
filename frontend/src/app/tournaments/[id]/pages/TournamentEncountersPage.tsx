import React, { Suspense } from "react";
import { Tournament } from "@/types/tournament.types";
import encounterService from "@/services/encounter.service";
import EncountersTable from "@/components/EncountersTable";

export interface TournamentEncounterPageProps {
  tournament: Tournament;
  page: number;
  search: string;
}

const TournamentEncountersPage = async ({
  tournament,
  page,
  search
}: TournamentEncounterPageProps) => {
  const encounters = await encounterService.getAll(page, search, tournament.id);

  return (
    <Suspense>
      <EncountersTable data={encounters} InitialPage={page} search={search} hideTournament={true} />
    </Suspense>
  );
};

export default TournamentEncountersPage;
