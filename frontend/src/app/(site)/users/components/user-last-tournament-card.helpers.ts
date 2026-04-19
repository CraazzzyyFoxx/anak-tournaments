import type { Tournament } from "@/types/tournament.types";
import type { DivisionGridVersion } from "@/types/workspace.types";

export function getLastTournamentGridVersion(
  tournamentId: number,
  tournaments: Tournament[]
): DivisionGridVersion | null {
  return tournaments.find((tournament) => tournament.id === tournamentId)?.division_grid_version ?? null;
}
