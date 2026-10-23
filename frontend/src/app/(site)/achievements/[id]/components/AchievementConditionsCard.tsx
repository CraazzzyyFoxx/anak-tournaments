"use client";

import { useTranslations } from "next-intl";

import ConditionTreeView from "@/app/(site)/achievements/components/ConditionTreeView";
import { CardSurface } from "@/components/profile/atoms";
import type { Achievement } from "@/types/achievement.types";
import type { WorkspaceAxis } from "@/lib/site/discipline-scope";

import AchievementConditionFlow from "./AchievementConditionFlow";

interface Props {
  achievement: Achievement;
  /** The page's viewing workspace axis (a tenant host's own): role names resolve in it, incl. its child roles. */
  axis: WorkspaceAxis;
}

/** "How to earn": the engine's conditions as sentences, with the tree itself
 *  one disclosure away. */
const AchievementConditionsCard = ({ achievement, axis }: Props) => {
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
      <ConditionTreeView tree={achievement.condition_tree} discipline={achievement.discipline} axis={axis} />
      <AchievementConditionFlow tree={achievement.condition_tree} discipline={achievement.discipline} axis={axis} />
    </CardSurface>
  );
};

export default AchievementConditionsCard;
