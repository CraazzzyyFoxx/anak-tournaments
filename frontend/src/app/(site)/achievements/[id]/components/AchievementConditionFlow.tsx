"use client";

import { useMemo } from "react";
import dynamic from "next/dynamic";
import { useTranslations } from "next-intl";

import type { TreeNode } from "@/components/rule-builder";
import { DEFAULT_CONDITION_TYPE, useConditionText } from "@/lib/achievements/condition-text";
import type { ConditionNode } from "@/types/achievement.types";
import type { WorkspaceAxis } from "@/lib/site/discipline-scope";

// @xyflow/react and its stylesheet are the heaviest thing this page pulls, so
// the canvas is a client-only chunk loaded after the page (and the sentences
// above it) have rendered.
const RuleBuilder = dynamic(
  () => import("@/components/rule-builder").then((m) => m.RuleBuilder),
  {
    ssr: false,
    loading: () => (
      <div className="h-[420px] w-full animate-pulse rounded-lg border border-[color:var(--aqt-border)] bg-[color:var(--aqt-bg-2)]" />
    ),
  }
);

/**
 * The engine's condition tree drawn on the same canvas the admin editor uses,
 * read-only, under the sentences: the structure, not just the prose. Includes
 * the screen-reader outline and fullscreen.
 */
export default function AchievementConditionFlow({
  tree,
  discipline,
  axis
}: Readonly<{ tree: ConditionNode; discipline: string; axis: WorkspaceAxis }>) {
  const t = useTranslations();
  const { leafLabel, leafLine } = useConditionText(tree, discipline, axis);

  const labels = useMemo(
    () => ({
      outlineTitle: t("achievements.conditionText.diagram.outlineTitle"),
      outlineGroup: (path: string, op: string) =>
        t("achievements.conditionText.diagram.outlineGroup", { path, op }),
      fullscreen: t("achievements.conditionText.diagram.fullscreen"),
      fullscreenLabel: t("achievements.conditionText.diagram.fullscreenLabel"),
      exitFullscreen: t("achievements.conditionText.diagram.exitFullscreen"),
      exitFullscreenLabel: t("achievements.conditionText.diagram.exitFullscreenLabel"),
    }),
    [t]
  );

  return (
    <div className="mt-5">
      <RuleBuilder
        value={tree as TreeNode}
        readOnly
        defaultLeafType={DEFAULT_CONDITION_TYPE}
        labelForLeaf={leafLabel}
        summarizeLeaf={leafLine}
        labels={labels}
        heightClass="h-[420px]"
      />
    </div>
  );
}
