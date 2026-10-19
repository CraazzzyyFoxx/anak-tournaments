"use client";

import { useTranslations } from "next-intl";

import ConditionTreeView from "@/app/(site)/achievements/components/ConditionTreeView";
import { CardSurface } from "@/components/profile/atoms";
import type { Achievement } from "@/types/achievement.types";

import AchievementConditionFlow from "./AchievementConditionFlow";

interface Props {
  achievement: Achievement;
}

/** "How to earn": the engine's conditions as sentences, with the tree itself
 *  one disclosure away. */
const AchievementConditionsCard = ({ achievement }: Props) => {
  const t = useTranslations();

  if (!achievement.condition_tree) {
    return (
      <CardSurface title={t("achievements.conditionText.title")}>
        <p className="text-sm text-[color:var(--aqt-fg-dim)]">
          {t("achievements.noConditionsDefined")}
        </p>
      </CardSurface>
    );
  }

  return (
    <CardSurface title={t("achievements.conditionText.title")}>
      <ConditionTreeView tree={achievement.condition_tree} discipline={achievement.discipline} />
      <AchievementConditionFlow tree={achievement.condition_tree} discipline={achievement.discipline} />
    </CardSurface>
  );
};

export default AchievementConditionsCard;
