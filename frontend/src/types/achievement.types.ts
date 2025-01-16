import { Tournament } from "@/types/tournament.types";

export interface Achievement {
  id: number;
  created_at: Date;
  updated_at: Date | null;
  name: string;
  slug: string;
  description_ru: string;
  description_en: string;
}

export interface AchievementRarity extends Achievement {
  rarity: number;
  count: number;
  tournaments_ids: number[];
  tournaments: Tournament[];
  matches: number[];
}
