import type { ScoreKind } from "@/components/match/cells";
import { mapWithModeName } from "@/lib/catalog/mode";
import { observedScore } from "@/lib/encounter/detail";
import { seatsBySlot } from "@/lib/encounter/seats";
import type { CatalogEntityRead } from "@/types/catalog.types";
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

/**
 * A parsed map's result for the viewer's seat: its own participation's observed score against the best of the
 * others'. A draw when the viewer has no seat in the match or a score was not recorded — unknown is not a win.
 */
export function mapKind(match: Pick<MatchWithUserStats, "participants">, own: Seat | null): ScoreKind {
  const mine = match.participants.find((participant) => participant.encounter_team_id === own?.id);
  const mineScore = mine ? observedScore(mine) : null;
  const others = match.participants.filter((participant) => participant !== mine).map(observedScore);
  if (mineScore == null || others.length === 0 || others.some((score) => score == null)) return "draw";
  return kindOf(mineScore, Math.max(...(others as number[])));
}

/** The viewer's characters across the encounter's maps, each once, in first-played order. */
export function uniqueViewerCharacters(enc: Pick<EncounterWithUserStats, "matches">): CatalogEntityRead[] {
  const byId = new Map<number, CatalogEntityRead>();
  for (const match of enc.matches ?? []) {
    for (const character of match.viewer?.characters ?? []) {
      if (!byId.has(character.id)) byId.set(character.id, character);
    }
  }
  return [...byId.values()];
}

/**
 * `MatchLogIndicator`'s per-map log refs ("Map · Mode · #id"), or `undefined` when the encounter has no logs.
 * `mapAlt` names a map the read did not expand.
 */
export function encounterLogEntries(enc: Pick<EncounterWithUserStats, "has_logs" | "matches">, mapAlt: string) {
  if (!enc.has_logs) return undefined;
  return (enc.matches ?? []).map((match) => ({
    matchId: match.id,
    rawAvailable: match.raw_available,
    label: `${mapWithModeName(match.map, match.mode) ?? mapAlt} · #${match.id}`
  }));
}
