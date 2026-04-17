import type { QueryClient } from "@tanstack/react-query";

export function getTournamentWorkspaceQueryKeys(tournamentId: number) {
  return {
    tournament: ["admin", "tournament", tournamentId] as const,
    teams: ["admin", "tournament", tournamentId, "teams"] as const,
    divisionGrids: ["admin", "tournament", tournamentId, "division-grids"] as const,
    standings: ["admin", "tournament", tournamentId, "standings"] as const,
    encounters: ["admin", "tournament", tournamentId, "encounters"] as const,
    discordChannel: ["admin", "tournament", tournamentId, "discord-channel"] as const,
    logHistory: ["admin", "tournament", tournamentId, "log-history"] as const,
    tournaments: ["tournaments"] as const,
    teamsCollection: ["teams"] as const,
    encountersCollection: ["encounters"] as const,
    standingsCollection: ["standings"] as const,
  };
}

export async function invalidateTournamentWorkspace(
  queryClient: QueryClient,
  tournamentId: number
) {
  const keys = getTournamentWorkspaceQueryKeys(tournamentId);

  await Promise.all([
    queryClient.invalidateQueries({ queryKey: keys.tournament }),
    queryClient.invalidateQueries({ queryKey: keys.teams }),
    queryClient.invalidateQueries({ queryKey: keys.standings }),
    queryClient.invalidateQueries({ queryKey: keys.encounters }),
    queryClient.invalidateQueries({ queryKey: keys.tournaments }),
    queryClient.invalidateQueries({ queryKey: keys.teamsCollection }),
    queryClient.invalidateQueries({ queryKey: keys.encountersCollection }),
    queryClient.invalidateQueries({ queryKey: keys.standingsCollection }),
  ]);
}
