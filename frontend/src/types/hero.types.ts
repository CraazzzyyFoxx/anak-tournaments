import { LogStatsName } from "@/types/stats.types";

export interface Hero {
  id: number;
  created_at: Date;
  updated_at: Date | null;
  name: string;
  slug: string;
  image_path: string;
  role: string;
  color: string;
}

export interface HeroPlaytime {
  hero: Hero;
  playtime: number;
}

export interface HeroBestStat {
  encounter_id: number;
  map_name: string;
  map_image_path: string;
  value: number;
  tournament_name: string;
  player_name: string;
}

export interface HeroStat {
  name: LogStatsName;
  overall: number;
  best: HeroBestStat;
  avg_10: number;
  best_all: HeroBestStat;
  avg_10_all: number;
}

export interface HeroWithUserStats {
  hero: Hero;
  stats: HeroStat[];
}
