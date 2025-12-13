export interface PlayerData {
  uuid: string;
  name: string;
  rating: number;
  discomfort: number;
  isCaptain: boolean;
  preferences: string[];
  allRatings: Record<string, number>;
}

export interface TeamData {
  id: number;
  name: string;
  avgMMR: number;
  variance: number;
  totalDiscomfort: number;
  maxDiscomfort: number;
  roster: Record<string, PlayerData[]>;
}

export interface Statistics {
  averageMMR: number;
  mmrStdDev: number;
  totalTeams: number;
  playersPerTeam: number;
}

export interface BalanceResponse {
  teams: TeamData[];
  statistics: Statistics;
}
