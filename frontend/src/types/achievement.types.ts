import { Tournament } from "@/types/tournament.types";
import { Match } from "./encounter.types";

export interface Achievement {
  id: number;
  created_at: Date;
  updated_at: Date | null;
  name: string;
  slug: string;
  description_ru: string;
  description_en: string;

  count: number | null;
  rarity: number;
}

export interface AchievementRarity extends Achievement {
  count: number;
  tournaments_ids: number[];
  tournaments: Tournament[];
  matches_ids: number[];
  matches: Match[]
}
