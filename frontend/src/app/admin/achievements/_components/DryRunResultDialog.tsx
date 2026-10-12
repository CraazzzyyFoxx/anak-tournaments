"use client";

import { useTranslations } from "next-intl";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

import type { DryRunResult } from "../_hooks/useAchievementRuleActions";

/** Who would qualify for a rule right now, without awarding anything. */
export function DryRunResultDialog({
  result,
  onDismiss,
}: Readonly<{ result: DryRunResult | null; onDismiss: () => void }>) {
  const t = useTranslations("adminAchievements");
  return (
    <Dialog open={!!result} onOpenChange={(open) => !open && onDismiss()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("dryRun.title", { slug: result?.slug ?? "" })}</DialogTitle>
          <DialogDescription>
            {t("dryRun.qualifies", { count: result?.count ?? 0 })}
          </DialogDescription>
        </DialogHeader>
        {result && result.sample.length > 0 && (
          <div className="text-sm">
            <p className="font-medium mb-2" id="dry-run-sample">{t("dryRun.sample")}</p>
            <div
              className="max-h-48 overflow-auto rounded border p-2 bg-muted/50 font-mono text-xs tabular-nums"
              tabIndex={0}
              role="group"
              aria-labelledby="dry-run-sample"
            >
              {result.sample.map((tuple, i) => (
                <div key={i}>
                  {t("dryRun.sampleRow", {
                    user: tuple[0],
                    hasTournament: tuple[1] ? "yes" : "no",
                    tournament: tuple[1] ?? "",
                    hasMatch: tuple[2] ? "yes" : "no",
                    match: tuple[2] ?? "",
                  })}
                </div>
              ))}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
