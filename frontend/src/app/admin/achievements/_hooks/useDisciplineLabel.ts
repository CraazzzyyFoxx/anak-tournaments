"use client";

import { useTranslations } from "next-intl";

/** A game's name for the achievement screens; an unknown code reads as itself rather than as a blank. */
export function useDisciplineLabel(): (discipline: string) => string {
  const t = useTranslations("adminAchievements");
  // Keys are built from a game code the statically typed `t` cannot know.
  const loose = t as unknown as { (key: string): string; has(key: string): boolean };
  return (discipline) => (loose.has(`discipline.names.${discipline}`) ? loose(`discipline.names.${discipline}`) : discipline);
}
