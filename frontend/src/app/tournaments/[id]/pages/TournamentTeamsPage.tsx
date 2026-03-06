import React from "react";
import { Tournament } from "@/types/tournament.types";
import teamService from "@/services/team.service";
import { TournamentTeamCard, TournamentTeamCardSkeleton } from "@/components/TournamentTeamCard";

export const TournamentTeamsPageSkeleton = () => {
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
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
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {teams.results.map((team) => (
        <TournamentTeamCard key={team.id} team={team} />
      ))}
    </div>
  );
};

export default TournamentTeamsPage;
