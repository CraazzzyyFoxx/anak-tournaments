import { MapRead } from "@/types/map.types";
import { Team, TeamWithStats } from "@/types/team.types";
import {
  EncounterResultStatus,
  Stage,
  StageItem,
  Tournament,
  TournamentGroup,
} from "@/types/tournament.types";

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
  best_of: number;
  tournament_id: number;
  tournament_group_id?: number | null;
  stage_id: number | null;
  stage_item_id: number | null;
  challonge_id: number | null;
  challonge_slug?: string | null;
  status: string;
  closeness: number | null;
  has_logs: boolean;
  result_status: EncounterResultStatus;
  submitted_by_id: number | null;
  submitted_at: Date | null;
  confirmed_by_id: number | null;
  confirmed_at: Date | null;

  matches: Match[];
  home_team: Team;
  away_team: Team;
  tournament: Tournament;
  stage?: Stage | null;
  stage_item?: StageItem | null;
  tournament_group?: TournamentGroup | null;
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
