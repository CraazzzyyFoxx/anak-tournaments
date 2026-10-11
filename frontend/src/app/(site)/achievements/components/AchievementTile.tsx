"use client";

import Link from "next/link";
import { Users } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";

import { AchievementArt } from "@/components/achievements/AchievementArt";
import { cn } from "@/lib/utils";
import { classifyRarity, localizedText, rarityVarClass } from "@/lib/achievements/rarity";
import type { Achievement } from "@/types/achievement.types";

/**
 * Image-forward catalog tile: the badge art is the hero, the name and the two
 * numbers that matter (share of players, players holding it) always sit on the
 * bottom scrim, so nothing essential is hover-only. Hover/focus additionally
 * reveals the description. The whole tile is one link to the detail page.
 */
const AchievementTile = ({ achievement }: { achievement: Achievement }) => {
  const t = useTranslations();
  const locale = useLocale();
  const holders = achievement.count ?? 0;
  const description = localizedText(locale, achievement.description_ru, achievement.description_en);

  return (
    <Link
      href={`/achievements/${achievement.id}`}
      // Unearned rules sit at 0% and would read as mythic; they stay neutral.
      className={cn(
        "aqt-ach-tile",
        rarityVarClass(holders > 0 ? classifyRarity(achievement.rarity * 100) : "common")
      )}
    >
      <AchievementArt
        achievement={achievement}
        sizes="(min-width: 1536px) 14vw, (min-width: 1024px) 20vw, (min-width: 640px) 25vw, 50vw"
        className="absolute inset-0"
        imgClassName="aqt-ach-tile__img"
      />

      {description ? (
        <span aria-hidden className="aqt-ach-tile__desc">
          <span>{description}</span>
        </span>
      ) : null}

      <span className="aqt-ach-tile__foot">
        <span className="aqt-ach-tile__name">{achievement.name}</span>
        <span className="aqt-ach-tile__meta">
          {holders > 0 ? (
            <>
              <span className="aqt-rar-fg tabular-nums">{(achievement.rarity * 100).toFixed(2)}%</span>
              <span
                className="inline-flex items-center gap-1 tabular-nums"
                aria-label={t("achievements.holders", { count: holders })}
              >
                <Users aria-hidden className="size-3" />
                {holders}
              </span>
            </>
          ) : (
            <span>{t("achievements.notEarned.tile")}</span>
          )}
        </span>
      </span>
    </Link>
  );
};

export default AchievementTile;
