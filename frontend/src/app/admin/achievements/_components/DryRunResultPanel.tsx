"use client";

import { X } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";

import type { DryRunResult } from "../_hooks/useAchievementRuleActions";

/** Who would qualify for a rule right now, without awarding anything. Shown under the table until dismissed. */
export function DryRunResultPanel({
  result,
  onDismiss,
}: Readonly<{ result: DryRunResult; onDismiss: () => void }>) {
  const t = useTranslations("adminAchievements");
  return (
    <section aria-labelledby="dry-run-title" className="space-y-3 rounded-xl border bg-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <h2 id="dry-run-title" className="text-sm font-semibold">
            {t("dryRun.title", { slug: result.slug })}
          </h2>
          <p className="text-sm text-muted-foreground">{t("dryRun.qualifies", { count: result.count })}</p>
        </div>
        <Button
          variant="ghost"
          size="icon"
          onClick={onDismiss}
          aria-label={t("dryRun.dismiss")}
          title={t("dryRun.dismiss")}
        >
          <X className="h-4 w-4" aria-hidden />
        </Button>
      </div>
      {result.sample.length > 0 && (
        <div className="space-y-1 border-t border-border/60 pt-3">
          <p className="text-caption font-medium" id="dry-run-sample">
            {t("dryRun.sample")}
          </p>
          <ul
            className="max-h-48 overflow-auto text-sm tabular-nums"
            tabIndex={0}
            aria-labelledby="dry-run-sample"
          >
            {result.sample.map((tuple, i) => (
              <li key={i}>
                {t("dryRun.sampleRow", {
                  user: tuple[0],
                  hasTournament: tuple[1] ? "yes" : "no",
                  tournament: tuple[1] ?? "",
                  hasMatch: tuple[2] ? "yes" : "no",
                  match: tuple[2] ?? "",
                })}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
