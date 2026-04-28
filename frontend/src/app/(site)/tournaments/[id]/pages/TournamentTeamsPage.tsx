"use client";

import { useQuery } from "@tanstack/react-query";
import { Tournament } from "@/types/tournament.types";
import teamService from "@/services/team.service";
import { TournamentTeamCard, TournamentTeamCardSkeleton } from "@/components/TournamentTeamCard";
import { tournamentQueryKeys } from "@/lib/tournament-query-keys";

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

const TournamentTeamsPage = ({ tournament }: { tournament: Tournament }) => {
  const teamsQuery = useQuery({
    queryKey: tournamentQueryKeys.teams(tournament.id),
    queryFn: () => teamService.getAll(tournament.id),
  });

  if (teamsQuery.isLoading) {
    return <TournamentTeamsPageSkeleton />;
  }

  const teams = teamsQuery.data;

  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {(teams?.results ?? []).map((team) => (
        <TournamentTeamCard key={team.id} team={team} />
      ))}
    </div>
  );
};

export default TournamentTeamsPage;
