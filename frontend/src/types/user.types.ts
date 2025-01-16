import { Hero, HeroPlaytime } from "@/types/hero.types";
import { Player } from "@/types/team.types";
import { Encounter, Match } from "@/types/encounter.types";
import { MapRead } from "@/types/map.types";
import { LogStatsName } from "@/types/stats.types";
import { UserTournamentStat } from "@/types/statistics.types";
import { Tournament } from "@/types/tournament.types";

export interface UserDiscord {
  id: number;
  user_id: number;
  created_at: Date;
  updated_at: Date | null;
  name: string;
}

export interface UserBattleTag {
  id: number;
  created_at: Date;
  updated_at: Date | null;
  name: string;
  tag: number;
  battle_tag: string;
}

export interface UserTwitch {
  id: number;
  created_at: Date;
  updated_at: Date | null;
  name: string;
}

export interface User {
  id: number;
  created_at: Date;
  updated_at: Date | null;
  name: string;
  discord: UserDiscord[];
  battle_tag: UserBattleTag[];
  twitch: UserTwitch[];
}

export interface UserRole {
  role: string;
  tournaments: number;
  maps_won: number;
  maps: number;
  division: number;
}

export interface UserTournamentWithStats {
  id: number;
  number: number;
  name: string;
  division: number;
  role: string;
  group_placement: number;
  playoff_placement: number;
  maps_won: number;
  maps: number;
  playtime: number;

  stats: Record<LogStatsName, UserTournamentStat>;
}

export interface MatchWithUserStats extends Match {
  performance: number;
  heroes: Hero[];
}

// @ts-ignore
export interface EncounterWithUserStats extends Encounter {
  matches: MatchWithUserStats[];
}

export interface UserTournament {
  id: number;
  name: string;
  number: number;
  is_league: boolean;
  team_id: number;
  team: string;
  players: Player[];
  closeness: number;
  placement: number;
  count_teams: number;
  won: number;
  lost: number;
  draw: number;
  maps_won: number;
  maps_lost: number;
  division: number;
  role: string;

  encounters: EncounterWithUserStats[];
}

export interface UserProfile {
  tournaments_count: number;
  tournaments_won: number;
  maps_total: number;
  maps_won: number;
  avg_closeness: number;
  avg_placement: number;
  avg_playoff_placement: number;
  avg_group_placement: number;
  most_played_hero: Hero;

  roles: UserRole[];
  hero_statistics: HeroPlaytime[];
  tournaments: Tournament[];
}

export interface UserMapRead {
  map: MapRead;
  count: number;
  win: number;
  loss: number;
  draw: number;
  win_rate: number;
}

export interface UserBestTeammate {
  user: User;
  tournaments: number;
  winrate: number;
  stats: Record<LogStatsName, number>;
}
