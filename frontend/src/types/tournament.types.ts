import { User } from "@/types/user.types";
import { Team } from "@/types/team.types";
import { Encounter } from "@/types/encounter.types";
import { DivisionGrid } from "@/types/workspace.types";

export interface TournamentGroup {
  id: number;
  created_at: Date;
  updated_at: Date | null;
  name: string;
  description: string | null;
  is_groups: boolean;
  challonge_id: number | null;
  challonge_slug: string | null;
}

export interface Tournament {
  id: number;
  created_at: Date;
  updated_at: Date | null;
  workspace_id: number;
  name: string;
  start_date: Date;
  end_date: Date;
  number: number;
  description: string | null;
  challonge_id: number | null;
  challonge_slug: string | null;
  is_league: boolean;
  is_finished: boolean;

  groups: TournamentGroup[];
  participants_count: number | null;
  registrations_count: number | null;
  division_grid: DivisionGrid | null;
}

export interface OwalStandingDay {
  tournament: Tournament;
  team: string;
  role: string;
  points: number;
  wins: number;
  draws: number;
  losses: number;
  win_rate: number;
}

export interface OwalStanding {
  user: User;
  role: string;
  division: number;
  days: Record<string, OwalStandingDay>;
  count_days: number;
  place: number;
  best_3_days: number;
  avg_points: number;
  wins: number;
  draws: number;
  losses: number;
  win_rate: number;
}

export interface OwalStandings {
  days: Tournament[];
  standings: OwalStanding[];
}

export interface Standings {
  id: number;
  tournament_id: number;
  group_id: number;
  team_id: number;
  position: number;
  overall_position: number;
  matches: number;
  win: number;
  draw: number;
  lose: number;
  points: number;
  buchholz: number | null;
  tb: number | null;

  team: Team | null;
  tournament: Tournament | null;
  group: TournamentGroup | null;
  matches_history: Encounter[];
}

export interface OwalStack {
  user_1: User;
  user_2: User;
  games: number;
  avg_position: number;
}
