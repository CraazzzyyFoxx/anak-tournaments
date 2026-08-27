import type { EncounterWithUserStats } from "@/types/user.types";

export type MapResultPip = "win" | "loss" | "draw";

export function tournamentMapPips(
  encounters: EncounterWithUserStats[],
  selfUserId: number
): MapResultPip[] | null {
  const pips: MapResultPip[] = [];
  for (const encounter of encounters) {
    const isUserHome =
      encounter.user_team_id != null
        ? encounter.home_team_id === encounter.user_team_id
        : (encounter.home_team?.players ?? []).some((player) => player.user_id === selfUserId);
    for (const match of encounter.matches ?? []) {
      const userScore = isUserHome ? match.score.home : match.score.away;
      const oppScore = isUserHome ? match.score.away : match.score.home;
      pips.push(userScore > oppScore ? "win" : userScore < oppScore ? "loss" : "draw");
    }
  }
  return pips.length > 0 ? pips : null;
}
