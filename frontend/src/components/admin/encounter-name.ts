import type { Team } from "@/types/team.types";

type EncounterTeam = Pick<Team, "id" | "name">;

function getTeamName(teams: EncounterTeam[], teamId: number | null | undefined): string {
  const name = teams.find((team) => team.id === teamId)?.name.trim();
  return name || "TBD";
}

/** `"A vs B"`, slot 1 first. */
export function buildEncounterName(
  teams: EncounterTeam[],
  firstTeamId: number | null | undefined,
  secondTeamId: number | null | undefined
): string {
  return `${getTeamName(teams, firstTeamId)} vs ${getTeamName(teams, secondTeamId)}`;
}
