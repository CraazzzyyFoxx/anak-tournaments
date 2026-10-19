import type {
  Encounter,
  EncounterGameWithMap,
  Match,
  MatchParticipant
} from "@/types/encounter.types";
import { acceptedScore, seriesMatchesByPosition } from "@/components/pick-ban/pick-ban-model";
import { duelSeats, duelWinner, seatsBySlot, type Duel, type DuelSlot } from "@/lib/encounter/seats";
import { getEncounterWinner, isEncounterCompleted } from "@/lib/encounter/status";

/**
 * Derivations for the encounter (series) detail page.
 *
 * Everything here reads the encounter payload the page already fetches — no
 * extra endpoint knowledge lives in the components. A duel is read by slot:
 * slot 1 is `one`, slot 2 is `two`. A game's own statistics are its
 * discipline module's (`disciplines/<code>/match`).
 */

/**
 * The score the log itself recorded for a participant: its observed whole-match `score` team fact. Absent
 * when the log recorded none — that is missing, not zero, and never the official result's score.
 */
export function observedScore(participant: Pick<MatchParticipant, "team_facts">): number | null {
  return participant.team_facts.score ?? null;
}

/** The log's own score line: each participant's observed score in seat order, an em dash where none was recorded. */
export function scoreLine(participants: readonly Pick<MatchParticipant, "slot" | "team_facts">[]): string {
  return seatsBySlot(participants)
    .map((participant) => observedScore(participant) ?? "—")
    .join(" – ");
}

/**
 * A parsed map's score by the encounter's seats: each seat reads its own participation's observed score, so a
 * log that listed the slot-2 team first still prints a 3–0 for slot 1 as 3–0. `null` when either seat has no
 * observed score (or no participant in this match, e.g. a retired participation played it).
 */
export function encounterSeatScore(
  match: Pick<Match, "participants">,
  encounter: Pick<Encounter, "teams">
): Duel<number> | null {
  const [first, second] = duelSeats(encounter.teams);
  const scoreOf = (seat: { id: number } | null): number | null => {
    const participant = match.participants.find((candidate) => candidate.encounter_team_id === seat?.id);
    return participant ? observedScore(participant) : null;
  };
  const one = scoreOf(first);
  const two = scoreOf(second);
  return one == null || two == null ? null : { one, two };
}

/**
 * One slot of the series: a position the encounter opened a game for, or a
 * placeholder for a map the format allows but that was never needed (a 3–0 in
 * a Bo5 leaves two empty slots).
 *
 * `game` and `match` are two separate contracts for the same position. The
 * game carries the RESULT — what the captains agreed or an admin ruled — and
 * the match is the parsed log, which may exist for a position with no result
 * and may disagree with one. Neither is derived from the other.
 */
export interface SeriesSlot {
  /** 1-based position in the series. */
  index: number;
  /** The encounter's own result for this position, when present. */
  game: EncounterGameWithMap | null;
  match: Match | null;
  /** The parsed log's score, in the encounter's seat order. */
  parsedScore: Duel<number> | null;
  winner: DuelSlot | null;
  /** The map the encounter says is being played right now. */
  isLive: boolean;
}

export function buildSeriesSlots(encounter: Encounter): SeriesSlot[] {
  const matches = encounter.matches ?? [];
  const games = encounter.games ?? [];
  // Only proven positions extend the format; unbound history creates no slots.
  const slotCount = Math.max(
    encounter.best_of || 0,
    ...games.map((game) => game.position),
    ...matches.map((match) => match.map_index ?? 0)
  );
  const live = isEncounterCompleted(encounter) ? null : encounter.current_map_index;
  const positions = Array.from({ length: slotCount }, (_, index) => index + 1);

  const gameAt = (position: number) => games.find((game) => game.position === position) ?? null;
  const byPosition = seriesMatchesByPosition(
    matches,
    positions.map((position) => gameAt(position)?.map_id ?? null)
  );

  return positions.map((position, index) => {
    const game = gameAt(position);
    const accepted = acceptedScore(game, encounter.teams);
    const match = byPosition[index];
    return {
      index: position,
      game,
      match,
      parsedScore: match ? encounterSeatScore(match, encounter) : null,
      // The accepted score decides the position; the parsed log is a separate
      // fact and never overrides it.
      winner: accepted == null ? null : duelWinner(accepted),
      isLive: live != null && live === index
    };
  });
}

/** Maps each seat actually took, counted from the per-map results. */
export function countMapWins(encounter: Encounter): { one: number; two: number; drawn: number } {
  let one = 0;
  let two = 0;
  let drawn = 0;
  for (const match of encounter.matches ?? []) {
    const score = encounterSeatScore(match, encounter);
    if (!score) continue;
    const winner = duelWinner(score);
    if (winner === 1) one += 1;
    else if (winner === 2) two += 1;
    else drawn += 1;
  }
  return { one, two, drawn };
}

type SeriesOutcome = "win" | "draw" | "unplayed";

export interface SeriesVerdict {
  outcome: SeriesOutcome;
  /** Slot of the winning seat, or null on a draw / an unfinished series. */
  winner: DuelSlot | null;
  loser: DuelSlot | null;
}

/**
 * The series result. Deliberately gated on completion the same way
 * `getEncounterWinner` is: a live 1–0 has a leader, not a winner.
 */
export function getSeriesVerdict(encounter: Encounter): SeriesVerdict {
  if (!isEncounterCompleted(encounter)) {
    return { outcome: "unplayed", winner: null, loser: null };
  }
  const winner = getEncounterWinner(encounter);
  if (winner == null) return { outcome: "draw", winner: null, loser: null };
  return { outcome: "win", winner, loser: winner === 1 ? 2 : 1 };
}

/** Total played time of the series, in seconds. `null` when no map reported one. */
export function getSeriesSeconds(encounter: Encounter): number | null {
  const matches = encounter.matches ?? [];
  let total = 0;
  let any = false;
  for (const match of matches) {
    if (match.duration_s != null && match.duration_s > 0) {
      total += match.duration_s;
      any = true;
    }
  }
  return any ? total : null;
}

/** Localized `1h 04m 30s` / `12m 05s` / `48s`. Units come from the catalog. */
export function formatSeriesClock(
  seconds: number | null | undefined,
  units: { h: string; m: string; s: string }
): string | null {
  if (seconds == null || !Number.isFinite(seconds) || seconds <= 0) return null;
  const total = Math.round(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const rest = total % 60;
  const pad = (value: number) => String(value).padStart(2, "0");
  if (hours > 0) return `${hours}${units.h} ${pad(minutes)}${units.m} ${pad(rest)}${units.s}`;
  if (minutes > 0) return `${minutes}${units.m} ${pad(rest)}${units.s}`;
  return `${rest}${units.s}`;
}

/** `closeness` is a 0..1 fraction; the UI shows whole percent. */
export function formatCloseness(value: number | null | undefined): string | null {
  if (value == null || !Number.isFinite(value)) return null;
  return `${Math.round(value * 100)}%`;
}
