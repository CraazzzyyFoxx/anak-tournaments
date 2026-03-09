import { Achievement, AchievementRarity } from "@/types/achievement.types";

export type AchievementDescriptionLocale = "ru" | "en";

export const hasAchievementDetails = (
  achievement: Achievement | AchievementRarity
): achievement is AchievementRarity => {
  return "tournaments_ids" in achievement && "matches" in achievement;
};

export const getAchievementDescription = (
  achievement: Achievement | AchievementRarity,
  locale: AchievementDescriptionLocale
) => {
  return locale === "ru" ? achievement.description_ru : achievement.description_en;
};
