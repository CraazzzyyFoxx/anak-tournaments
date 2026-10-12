import type { ScoreKind } from "@/components/match/cells";
import { seatsBySlot } from "@/lib/encounter/seats";
import type { EncounterWithUserStats, MatchWithUserStats } from "@/types/user.types";

/**
 * What the profile's encounter lists ask the read to join. Lives here, not as a
 * default of `userService.getUserEncounters`: that service is reachable from
 * the root layout, and the quoted entity names would read to the zone i18n
 * check as the `teams` message namespace the root bundle does not ship.
 */
export const USER_ENCOUNTER_ENTITIES = ["tournament", "stage", "stage_item", "teams", "teams.players", "matches.map"];

type Seat = EncounterWithUserStats["teams"][number];

/** An encounter read from the profile owner's seat; `own` is null when no seat is theirs. */
export interface EncounterPerspective {
  own: Seat | null;
  opponent: Seat | null;
  userScore: number;
  oppScore: number;
  kind: ScoreKind;
}

const kindOf = (user: number, opp: number): ScoreKind =>
  user > opp ? "win" : user < opp ? "loss" : "draw";

/**
 * The viewer's own seat, found by the source team (`teamId`, else the read's
 * `user_team_id`) and falling back to the roster. Never by slot: an encounter
 * has no sides.
 */
export function encounterPerspective(
  enc: Pick<EncounterWithUserStats, "teams" | "user_team_id">,
  selfUserId: number,
  teamId?: number | null
): EncounterPerspective {
  const seats = seatsBySlot(enc.teams);
  const ownTeamId = teamId ?? enc.user_team_id;
  const own =
    seats.find((seat) => ownTeamId != null && seat.team_id === ownTeamId) ??
    seats.find((seat) => seat.players.some((player) => player.user_id === selfUserId)) ??
    null;
  const opponent = seats.find((seat) => seat !== own) ?? null;
  const userScore = own?.score ?? 0;
  const oppScore = opponent?.score ?? 0;
  return { own, opponent, userScore, oppScore, kind: kindOf(userScore, oppScore) };
}

/** A parsed map's result for the viewer's seat; a log records its own two sides (V4). */
export function mapKind(match: Pick<MatchWithUserStats, "score" | "home_team_id">, own: Seat | null): ScoreKind {
  const userIsLogHome = own?.team_id != null && match.home_team_id === own.team_id;
  return userIsLogHome ? kindOf(match.score.home, match.score.away) : kindOf(match.score.away, match.score.home);
}
