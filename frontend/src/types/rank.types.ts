// Rank history — mirrors shared/schemas/rank_collection.py (every game that collects native ranks).

type RankPlatform = "pc" | "console";

interface RankHistoryPoint {
  captured_at: string;
  rank_value: number | null;
  division: string | null;
  tier: number | null;
  is_ranked: boolean;
  season: number | null;
  /** League of Legends only. */
  lp?: number | null;
  wins?: number | null;
  losses?: number | null;
}

export interface RankSeries {
  social_account_id: number;
  handle: string;
  role: string | null;
  platform: string | null;
  /** League of Legends: "solo" | "flex". */
  queue?: string | null;
  points: RankHistoryPoint[];
  current: RankHistoryPoint | null;
  peak_rank_value: number | null;
  latest_captured_at: string | null;
}

export interface RankHistoryResponse {
  user_id: number | null;
  series: RankSeries[];
  generated_at: string;
}

export interface CurrentRank extends RankHistoryPoint {
  social_account_id: number;
  handle: string;
  role: string | null;
  platform: string | null;
  queue?: string | null;
}

export interface CurrentRanksResponse {
  user_id: number | null;
  ranks: CurrentRank[];
  generated_at: string;
}

export interface RankHistoryQuery {
  /** The game whose collector answers (`?discipline=`). */
  discipline: string;
  platform?: RankPlatform;
  /** The collector's role code, as `rpc.stats.rank.user_history` takes it. */
  role?: string;
  socialAccountId?: number;
  dateFrom?: string;
  dateTo?: string;
  granularity?: "raw" | "daily" | "hourly";
}
