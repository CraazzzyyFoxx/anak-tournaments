import type { CharacterLeaderboardEntry } from "@/types/statistics.types";

import type { StatColumnDef } from "./stat-columns";

/** One player's place on the board. The rank is the whole board's: a search narrows the rows, never renumbers them. */
export interface RankedEntry {
  entry: CharacterLeaderboardEntry;
  rank: number;
}

/**
 * The players at or above the sample floor. Under it a per-10 average rests on a game or two, so the player is left
 * off the board and its headline figures rather than ranked on noise.
 */
export function atSampleFloor(
  rows: readonly CharacterLeaderboardEntry[],
  minGames: number
): CharacterLeaderboardEntry[] {
  return rows.filter((row) => row.games_played >= minGames);
}

/** The board: the floor's players in the column's order, ranked from 1. */
export function rankEntries(
  rows: readonly CharacterLeaderboardEntry[],
  minGames: number,
  def: StatColumnDef,
  dir: "asc" | "desc"
): RankedEntry[] {
  const sign = dir === "asc" ? 1 : -1;
  return atSampleFloor(rows, minGames)
    .sort((a, b) => (def.getValue(a) - def.getValue(b)) * sign)
    .map((entry, index) => ({ entry, rank: index + 1 }));
}

/** The ranked rows whose name holds `query`, case-insensitively, each keeping its rank. */
export function searchEntries(ranked: readonly RankedEntry[], query: string): readonly RankedEntry[] {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return ranked;
  return ranked.filter(({ entry }) => entry.username.toLocaleLowerCase().includes(needle));
}

/** Count of `sorted` values below `value` (`strict`) or at most `value`; `sorted` is ascending. */
function countUpTo(sorted: readonly number[], value: number, strict: boolean): number {
  let low = 0;
  let high = sorted.length;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (strict ? sorted[mid] < value : sorted[mid] <= value) low = mid + 1;
    else high = mid;
  }
  return low;
}

/**
 * The share (0..1) of the other ranked players a value beats in its column. Ties beat no one, and a lower-is-better
 * column counts the players above it, so a longer bar is a better player in every column. `sorted` is the column's
 * values over the ranked players, ascending.
 */
export function beatsShare(sorted: readonly number[], value: number, lowerIsBetter: boolean): number {
  const others = sorted.length - 1;
  if (others <= 0) return 1;
  const beaten = lowerIsBetter
    ? sorted.length - countUpTo(sorted, value, false)
    : countUpTo(sorted, value, true);
  return beaten / others;
}
