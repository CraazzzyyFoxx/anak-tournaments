import { User } from "@/types/user.types";
import { Team } from "@/types/team.types";
import { Encounter } from "@/types/encounter.types";

export interface TournamentGroup {
  id: number;
  created_at: Date;
  updated_at: Date | null;
  name: string;
  is_playoffs: boolean;
  is_groups: boolean;
  challonge_id: number;
  challonge_slug: string;
}

export interface Tournament {
  id: number;
  created_at: Date;
  updated_at: Date | null;
  name: string;
  start_date: Date;
  end_date: Date;
  number: number;
  description: string | null;
  challonge_id: number;
  challonge_slug: string;
  is_league: boolean;
  is_finished: boolean;

  groups: TournamentGroup[];
  participants_count: number | null;
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
