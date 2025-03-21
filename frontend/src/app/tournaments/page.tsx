import React from "react";
import tournamentService from "@/services/tournament.service";
import TournamentCard from "@/app/tournaments/components/TournamentCard";

const TournamentsPage = async () => {
  const tournaments = await tournamentService.getAll();

  return (
    <div className="grid xs:grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-8">
      {tournaments.results.map((tournament) => (
        <TournamentCard key={tournament.id} tournament={tournament} />
      ))}
    </div>
  );
};

export default TournamentsPage;
