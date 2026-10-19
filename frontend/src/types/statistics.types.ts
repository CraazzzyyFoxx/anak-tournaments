import type { Schema } from "@/types/api";

export interface TournamentStatistics {
  id: number;
  name: string;
  players_count: number;
  avg_sr: number;
  avg_closeness: number;
}

/** One tournament's average division per top-level role code of its game's rated dimension (unplayed roles absent). */
export type TournamentDivisionStatistics = Schema<"tournament.DivisionStatistics">;

export interface PlayerStatistics {
  id: number;
  name: string;
  value: number;
}

export interface TournamentOverall {
  tournaments: number;
  teams: number;
  players: number;
  champions: number;
  /** Encounters (series) with a result. */
  encounters: number;
  /** Maps played (`matches.match` rows). */
  maps: number;
  /** Distinct calendar days covered by the tournaments' start..end dates. */
  days: number;
  /** Total played map time, whole hours. */
  hours: number;
}

export interface UserTournamentStat {
  value: number;
  rank: number;
  total: number;
}

/** One player's row on a character's leaderboard (per-10 averages over the player's eligible matches). */
export type CharacterLeaderboardEntry = Schema<"app.CharacterLeaderboardEntry">;
