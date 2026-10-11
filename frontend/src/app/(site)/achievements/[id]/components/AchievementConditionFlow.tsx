"use client";

import { useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { ChevronDown } from "lucide-react";
import { useTranslations } from "next-intl";

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import type { TreeNode } from "@/components/rule-builder";
import { DEFAULT_CONDITION_TYPE, useConditionText } from "@/lib/achievements/condition-text";
import type { ConditionNode } from "@/types/achievement.types";

// @xyflow/react and its stylesheet are the heaviest thing this page could pull,
// and the sentences above already answer "how do I earn this" - so the canvas
// only loads once somebody opens the disclosure.
const RuleBuilder = dynamic(
  () => import("@/components/rule-builder").then((m) => m.RuleBuilder),
  {
    ssr: false,
    loading: () => (
      <div className="h-75 w-full animate-pulse rounded-lg border border-[color:var(--aqt-border)] bg-[color:var(--aqt-bg-2)]" />
    ),
  }
);

/**
 * The same conditions as the engine's tree, for readers who want the structure
 * rather than the prose. Read-only: it is the admin editor's canvas with the
 * editing half absent, including the screen-reader outline.
 */
export default function AchievementConditionFlow({ tree }: Readonly<{ tree: ConditionNode }>) {
  const t = useTranslations();
  const [open, setOpen] = useState(false);
  const { leafLabel, leafLine } = useConditionText(tree);

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
    <Collapsible open={open} onOpenChange={setOpen} className="mt-4">
      <CollapsibleTrigger className="flex items-center gap-1.5 rounded text-sm text-[color:var(--aqt-fg-dim)] transition-colors hover:text-[color:var(--aqt-fg)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--aqt-teal)]">
        <ChevronDown
          aria-hidden
          size={15}
          className={open ? "rotate-180 transition-transform" : "transition-transform"}
        />
        {t("achievements.conditionText.diagram.toggle")}
      </CollapsibleTrigger>
      <CollapsibleContent>
        {open ? (
          <div className="mt-3">
            <RuleBuilder
              value={tree as TreeNode}
              readOnly
              defaultLeafType={DEFAULT_CONDITION_TYPE}
              labelForLeaf={leafLabel}
              summarizeLeaf={leafLine}
              labels={labels}
            />
          </div>
        ) : null}
      </CollapsibleContent>
    </Collapsible>
  );
}
