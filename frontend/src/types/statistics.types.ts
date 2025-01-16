export interface TournamentStatistics {
  id: number;
  number: number;
  players_count: number;
  avg_sr: number;
  avg_closeness: number;
}

export interface TournamentDivisionStatistics {
  id: number;
  number: number;
  tank_avg_div: number;
  damage_avg_div: number;
  support_avg_div: number;
}

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
}

export interface UserTournamentStat {
  value: number;
  rank: number;
  total: number;
}
