import { MapRead } from "@/types/map.types";
import { Team, TeamWithStats } from "@/types/team.types";
import { Tournament, TournamentGroup } from "@/types/tournament.types";

export interface Score {
  home: number;
  away: number;
}

export interface Encounter {
  id: number;
  created_at: Date;
  updated_at: Date | null;
  name: string;
  home_team_id: number;
  away_team_id: number;
  score: Score;
  round: number;
  tournament_id: number;
  tournament_group_id: number;
  challonge_id: number;
  challonge_slug: string;
  closeness: number | null;
  has_logs: boolean;

  matches: Match[];
  home_team: Team;
  away_team: Team;
  tournament: Tournament;
  tournament_group: TournamentGroup;
}

export interface Match {
  id: number;
  created_at: Date;
  updated_at: Date | null;
  home_team_id: number;
  away_team_id: number;
  score: Score;
  time: number;
  encounter_id: number;
  map_id: number;
  log_name: string;

  map: MapRead | null;
  home_team: Team | null;
  away_team: Team | null;
  encounter: Encounter | null;
}

export interface MatchWithStats extends Match {
  rounds: number;
  home_team: TeamWithStats;
  away_team: TeamWithStats;
}
