import type {
  AchievementCategory,
  AchievementGrain,
  AchievementScope,
} from "@/types/admin.types";

/**
 * The enum values a rule can take, in the order both achievement screens
 * offer them. Each is shown as its `common.*Values` word, never an icon.
 */
export const CATEGORIES: AchievementCategory[] = [
  "overall",
  "hero",
  "division",
  "team",
  "standing",
  "match"
];
export const SCOPES: AchievementScope[] = ["global", "tournament", "match"];
export const GRAINS: AchievementGrain[] = ["user", "user_tournament", "user_match"];
