import React from "react";
import { Tournament } from "@/types/tournament.types";
import teamService from "@/services/team.service";
import { TournamentTeamCard, TournamentTeamCardSkeleton } from "@/components/TournamentTeamCard";

export const TournamentTeamsPageSkeleton = () => {
  return (
    <div className="grid xl:grid-cols-2 gap-8">
      <TournamentTeamCardSkeleton />
      <TournamentTeamCardSkeleton />
      <TournamentTeamCardSkeleton />
      <TournamentTeamCardSkeleton />
      <TournamentTeamCardSkeleton />
      <TournamentTeamCardSkeleton />
      <TournamentTeamCardSkeleton />
      <TournamentTeamCardSkeleton />
    </div>
  );
};

const TournamentTeamsPage = async ({ tournament }: { tournament: Tournament }) => {
  const teams = await teamService.getAll(tournament.id);

  return (
    <div className="grid xl:grid-cols-3 md:grid-cols-1 xs:grid-cols-1 gap-8">
      {teams.results.map((team) => (
        <TournamentTeamCard key={team.id} team={team} />
      ))}
    </div>
  );
};

export default TournamentTeamsPage;
