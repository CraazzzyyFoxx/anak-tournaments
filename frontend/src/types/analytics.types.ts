import { Player, Team } from "@/types/team.types";

export interface AlgorithmAnalytics {
  id: number;
  name: string;
}

export interface PlayerAnalytics extends Player {
  move_1: number;
  move_2: number;
  points: number;
  shift: number;
}

export interface TeamAnalytics extends Team {
  players: PlayerAnalytics[];
  balancer_shift: number;
  manual_shift: number;
  total_shift: number;
}

export interface TournamentAnalytics {
  teams: TeamAnalytics[];
  teams_wins: Record<number, number>;
}
