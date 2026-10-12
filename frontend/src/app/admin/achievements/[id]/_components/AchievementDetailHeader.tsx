"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import {
  ArrowLeft,
  CheckCircle,
  CircleOff,
  Eye,
  EyeOff,
  Pencil,
  Play,
  TestTube,
  Trash2
} from "lucide-react";

import { AchievementArt } from "@/components/achievements/AchievementArt";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { StatusIcon } from "@/components/admin/StatusIcon";
import { Button } from "@/components/ui/button";
import type { AchievementRule } from "@/types/admin.types";

export function AchievementDetailHeader({
  rule,
  canUpdate,
  canDelete,
  isEvaluating,
  onTest,
  onEvaluate,
  onToggle,
  onEdit,
  onDelete
}: Readonly<{
  rule: AchievementRule;
  canUpdate: boolean;
  canDelete: boolean;
  isEvaluating: boolean;
  onTest: () => void;
  onEvaluate: () => void;
  onToggle: () => void;
  onEdit: () => void;
  onDelete: () => void;
}>) {
  const t = useTranslations("adminAchievements");
  return (
    <div className="flex items-start gap-3">
      <Button variant="ghost" size="icon" asChild aria-label={t("common.back")}>
        <Link href="/admin/achievements">
          <ArrowLeft aria-hidden className="h-4 w-4" />
        </Link>
      </Button>
      <AchievementArt achievement={rule} sizes="48px" className="size-12 shrink-0 rounded-lg border" />
      <div className="min-w-0 flex-1">
        <AdminPageHeader
          title={rule.name}
          description={rule.slug}
          meta={
            rule.enabled ? (
              <StatusIcon icon={CheckCircle} label={t("common.enabled")} variant="success" />
            ) : (
              <StatusIcon icon={CircleOff} label={t("common.disabled")} variant="muted" />
            )
          }
          actions={
            <>
              <Button variant="outline" size="sm" onClick={onTest}>
                <TestTube aria-hidden className="mr-2 h-4 w-4" />
                {t("detail.testConditions")}
              </Button>
              <Button variant="outline" size="sm" onClick={onEvaluate}>
                <Play
                  aria-hidden
                  className={`mr-2 h-4 w-4 ${isEvaluating ? "animate-spin" : ""}`}
                />
                {isEvaluating ? t("common.evaluating") : t("detail.runEvaluation")}
              </Button>
              {canUpdate && (
                <Button variant="outline" size="sm" onClick={onToggle}>
                  {rule.enabled ? (
                    <EyeOff aria-hidden className="mr-2 h-4 w-4" />
                  ) : (
                    <Eye aria-hidden className="mr-2 h-4 w-4" />
                  )}
                  {rule.enabled ? t("detail.disableAchievement") : t("detail.enableAchievement")}
                </Button>
              )}
              {canUpdate && (
                <Button size="sm" onClick={onEdit}>
                  <Pencil aria-hidden className="mr-2 h-4 w-4" />
                  {t("detail.editAchievement")}
                </Button>
              )}
              {canDelete && (
                <Button variant="destructive" size="sm" onClick={onDelete}>
                  <Trash2 aria-hidden className="mr-2 h-4 w-4" />
                  {t("detail.deleteAchievement")}
                </Button>
              )}
            </>
          }
        />
      </div>
    </div>
  );
}
