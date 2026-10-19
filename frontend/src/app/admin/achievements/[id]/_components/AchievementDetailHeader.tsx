"use client";

import { useTranslations } from "next-intl";
import { MoreHorizontal } from "lucide-react";

import { EntityHubHeader } from "@/components/kit/EntityHubHeader";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Spinner } from "@/components/ui/spinner";
import type { AchievementRule } from "@/types/admin.types";

/**
 * The rule's hub header: name, slug, a pill only when the rule is disabled,
 * Edit as the one primary action and everything else in the menu. The menu
 * trigger turns into a spinner while a test or an evaluation is running.
 */
export function AchievementDetailHeader({
  rule,
  canUpdate,
  canDelete,
  isBusy,
  onTest,
  onEvaluate,
  onToggle,
  onEdit,
  onDelete,
}: Readonly<{
  rule: AchievementRule;
  canUpdate: boolean;
  canDelete: boolean;
  isBusy: boolean;
  onTest: () => void;
  onEvaluate: () => void;
  onToggle: () => void;
  onEdit: () => void;
  onDelete: () => void;
}>) {
  const t = useTranslations("adminAchievements");
  return (
    <EntityHubHeader
      backHref="/admin/achievements"
      title={rule.name}
      status={rule.enabled ? undefined : { label: t("common.disabled"), tone: "neutral" }}
      meta={[<span key="slug" className="font-mono text-caption">{rule.slug}</span>]}
      actions={
        <>
          {canUpdate && <Button onClick={onEdit}>{t("detail.editAchievement")}</Button>}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                size="icon"
                aria-label={t("common.moreActions")}
                title={t("common.moreActions")}
              >
                {isBusy ? <Spinner /> : <MoreHorizontal className="h-4 w-4" aria-hidden />}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={onTest}>{t("detail.testConditions")}</DropdownMenuItem>
              <DropdownMenuItem onSelect={onEvaluate}>{t("detail.runEvaluation")}</DropdownMenuItem>
              {canUpdate && (
                <DropdownMenuItem onSelect={onToggle}>
                  {rule.enabled ? t("detail.disableAchievement") : t("detail.enableAchievement")}
                </DropdownMenuItem>
              )}
              {canDelete && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onSelect={onDelete} className="text-danger focus:text-danger">
                    {t("detail.deleteAchievement")}
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </>
      }
    />
  );
}
