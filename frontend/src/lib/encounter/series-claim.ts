import { ApiError } from "@/lib/api/error";

import type { EncounterGame } from "@/types/tournament.types";

/**
 * The series report's local validation: a port of
 * `shared.domain.encounter_scoring.series_claim_errors`, answering with the
 * same codes so the form and the server reject the same claims. The server
 * stays the authority; this only spares a captain a round trip.
 *
 * Ceiling: a `points` card (a lobby) pays through the organizer's game formula,
 * which the browser does not evaluate, so its wins and totals are checked by the
 * server alone. Everything else runs here.
 */
export type SeriesClaimErrorCode =
  | "series_claim_teams"
  | "series_claim_games_played"
  | "series_claim_not_final"
  | "series_claim_unreachable"
  | "series_claim_wins"
  | "series_claim_mismatch";

/** `wins` is a Bo-N series; `points` is a lobby's card, played to its end. */
export type SeriesPreset = "wins" | "points";

export interface SeriesClaim {
  /** Draws included. */
  gamesPlayed: number;
  /** Per `EncounterTeam.id`. */
  totals: Record<number, number>;
  /** Per `EncounterTeam.id`; null when the form does not ask for wins. */
  wins: Record<number, number> | null;
}

/** `WINS_END_FORMULA` / `POINTS_END_FORMULA` of the backend. */
export function encounterEnded(
  preset: SeriesPreset,
  { bestOf, games, maxWins }: { bestOf: number; games: number; maxWins: number }
): boolean {
  return games >= bestOf || (preset === "wins" && maxWins * 2 > bestOf);
}

/** The participation that won a confirmed game outright, or null on a shared first place. */
function soleWinner(game: EncounterGame): number | null {
  const lines = game.teams;
  const placed = lines.length > 0 && lines.every((line) => line.placement != null);
  // Higher raw score is better; a place, when every line has one, is better lower.
  const rank = (line: EncounterGame["teams"][number]) =>
    placed ? -(line.placement as number) : (line.score ?? 0);
  if (!placed && lines.every((line) => line.score == null)) return null;
  const best = Math.max(...lines.map(rank));
  // A place is a win only as the sole first place (the server's `win` variable).
  if (placed && best !== -1) return null;
  const first = lines.filter((line) => rank(line) === best);
  return first.length === 1 ? first[0].encounter_team_id : null;
}

export function seriesClaimErrors({
  preset,
  bestOf,
  teamIds,
  games,
  claim
}: {
  preset: SeriesPreset;
  bestOf: number;
  teamIds: readonly number[];
  /** The encounter's games; only the confirmed ones are on record. */
  games: readonly EncounterGame[];
  claim: SeriesClaim;
}): SeriesClaimErrorCode[] {
  const errors: SeriesClaimErrorCode[] = [];
  const teams = new Set(teamIds);
  const sameTeams = (mapping: Record<number, number> | null) =>
    mapping == null ||
    (Object.keys(mapping).length === teams.size && Object.keys(mapping).every((id) => teams.has(Number(id))));
  if (!sameTeams(claim.totals) || !sameTeams(claim.wins)) errors.push("series_claim_teams");

  // Only the games the LIVE seats played count (a participation taken over
  // retires its games' lines): the server's `confirmed_game_lines`.
  const confirmed = games.filter(
    (game) => game.state === "confirmed" && game.teams.every((line) => teams.has(line.encounter_team_id))
  );
  if (!(confirmed.length <= claim.gamesPlayed && claim.gamesPlayed <= bestOf)) {
    errors.push("series_claim_games_played");
  }

  const maxWins = claim.wins ? Math.max(0, ...Object.values(claim.wins)) : 0;
  if (!encounterEnded(preset, { bestOf, games: claim.gamesPlayed, maxWins })) {
    errors.push("series_claim_not_final");
  }
  // The kindest ordering of the unseen games is the one that ends latest: a team
  // claiming W wins over G games had at least W - (G - played) of them after `played`.
  for (let played = 1; played < claim.gamesPlayed; played++) {
    const forced = Math.max(0, maxWins - (claim.gamesPlayed - played));
    if (encounterEnded(preset, { bestOf, games: played, maxWins: forced })) {
      errors.push("series_claim_unreachable");
      break;
    }
  }

  if (preset === "wins") {
    const won: Record<number, number> = Object.fromEntries(teamIds.map((id) => [id, 0]));
    for (const game of confirmed) {
      const winner = soleWinner(game);
      if (winner != null) won[winner] = (won[winner] ?? 0) + 1;
    }
    if (claim.wins && Object.entries(won).some(([id, count]) => (claim.wins?.[Number(id)] ?? 0) < count)) {
      errors.push("series_claim_wins");
    }
    // A duel's game formula is `win`, so its totals are its wins.
    if (
      claim.gamesPlayed === confirmed.length &&
      Object.entries(won).some(([id, count]) => (claim.totals[Number(id)] ?? 0) !== count)
    ) {
      errors.push("series_claim_mismatch");
    }
  }
  return errors;
}

/**
 * Codes a series report can be refused with, each worded under
 * `matchReport.errors.<code>`: the claim's own six, plus the two 409s that
 * mean "reload, the result moved on".
 */
export const SERIES_REPORT_ERROR_CODES = [
  "series_claim_teams",
  "series_claim_games_played",
  "series_claim_not_final",
  "series_claim_unreachable",
  "series_claim_wins",
  "series_claim_mismatch",
  "stale_state",
  "result_locked"
] as const;

export type SeriesReportErrorCode = (typeof SERIES_REPORT_ERROR_CODES)[number];

/** Every known code on a thrown error, in the order the server listed them. */
export function seriesReportErrorCodes(error: unknown): SeriesReportErrorCode[] {
  if (!(error instanceof ApiError)) return [];
  return error.details.flatMap((detail) =>
    SERIES_REPORT_ERROR_CODES.filter((known) => known === detail.code)
  );
}
