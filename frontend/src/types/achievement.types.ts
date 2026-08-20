import { Score } from "./encounter.types";
import { User } from "@/types/user.types";

export type AchievementCategory = "overall" | "hero" | "division" | "team" | "standing" | "match";
type AchievementScope = "global" | "tournament" | "match";

export type ConditionNode =
  | { AND: ConditionNode[] }
  | { OR: ConditionNode[] }
  | { NOT: ConditionNode }
  | { type: string; params: Record<string, unknown> };

export interface Achievement {
  id: number;
  created_at: Date;
  updated_at: Date | null;
  name: string;
  slug: string;
  description_ru: string;
  description_en: string;
  image_url: string | null;

  category: AchievementCategory | null;
  scope: AchievementScope | null;
  condition_tree: ConditionNode | null;

  count: number | null;
  rarity: number;
}

interface AchievementTournamentLink {
  id: number;
  name: string;
  is_league: boolean;
}

interface AchievementMatchTeamRef {
  id: number;
  name: string;
  /** Uploaded team image (S3 URL); `null` when the team has none. */
  image_url: string | null;
}

export interface AchievementMatchLink {
  id: number;
  encounter_id: number;
  map_id: number;
  score: Score;
  log_name: string | null;
  time: number | null;
  home_team: AchievementMatchTeamRef | null;
  away_team: AchievementMatchTeamRef | null;
}

export interface AchievementRarity extends Achievement {
  count: number;
  tournaments_ids: number[];
  tournaments: AchievementTournamentLink[];
  matches_ids: number[];
  matches: AchievementMatchLink[];
}

export interface AchievementEarned {
  user: User;
  count: number;
  last_tournament: AchievementTournamentLink | null;
  last_match: AchievementMatchLink | null;
}
