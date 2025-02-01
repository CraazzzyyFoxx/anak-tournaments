import { User } from "@/types/user.types";
import { Tournament, TournamentGroup } from "@/types/tournament.types";
import { LogStatsName } from "@/types/stats.types";
import { Hero } from "@/types/hero.types";

export interface Player {
  id: number;
  created_at: Date;
  updated_at: Date | null;
  name: string;
  primary: boolean;
  secondary: boolean;
  rank: number;
  division: number;
  role: string;
  tournament_id: number;
  user_id: number;
  team_id: number;
  is_newcomer: boolean;
  is_newcomer_role: boolean;
  is_substitution: boolean;
  relative_player: number;

  user: User;
}

export interface Team {
  id: number;
  created_at: Date;
  updated_at: Date | null;
  name: string;
  avg_sr: number;
  total_sr: number;
  tournament_id: number;
  players: Player[];
  tournament: Tournament | null;
  placement: number | null;
  group: TournamentGroup | null;
}

export interface PlayerWithStats extends Player {
  stats: Record<number, Record<LogStatsName, number>>;
  heroes: Record<number, Hero[]>;
}

export interface TeamWithStats extends Team {
  players: PlayerWithStats[];
}


export interface PlayerAnalytics extends Player {
  move_1: number;
  move_2: number;
  points: number;
}

export interface TeamAnalytics extends Team {
  players: PlayerAnalytics[];
}