"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";

import type { UserMergePreviewResponse } from "@/types/admin.types";

// The backend reports affected-record counts under raw FK-path keys
// (e.g. "tournament.player.workspace_member_id"). Map them to human-readable
// labels for the admin preview; unknown keys fall back to the raw key.
type AffectedRecordLabel =
  | "tournamentRosterEntries"
  | "balancerRegistrations"
  | "achievementResults"
  | "achievementOverrides"
  | "linkedAccount";
const AFFECTED_RECORD_LABELS: Record<string, AffectedRecordLabel> = {
  "tournament.player.workspace_member_id": "tournamentRosterEntries",
  "balancer.registration.workspace_member_id": "balancerRegistrations",
  "achievements.evaluation_result.workspace_member_id": "achievementResults",
  "achievements.override.workspace_member_id": "achievementOverrides",
  "players.user.auth_user_id": "linkedAccount"
};

export function AffectedRecordsSummary({
  preview,
  targetName
}: Readonly<{
  preview: UserMergePreviewResponse;
  targetName: string;
}>) {
  const t = useTranslations("adminPeople.merge");
  const affectedEntries = useMemo(
    () =>
      Object.entries(preview.affected_counts)
        .filter(([, count]) => count > 0)
        .sort((a, b) => b[1] - a[1]),
    [preview]
  );

  return (
    <div className="space-y-3">
      <p className="text-sm font-medium" id="merge-affected-records">
        {t("moving", { name: targetName })}
      </p>
      <div aria-labelledby="merge-affected-records">
        {affectedEntries.length > 0 ? (
          <div className="space-y-1.5 text-sm">
            {affectedEntries.map(([key, count]) => (
              <div key={key} className="flex items-baseline justify-between gap-3">
                <span className="text-muted-foreground">{AFFECTED_RECORD_LABELS[key] ? t(AFFECTED_RECORD_LABELS[key]) : key}</span>
                <span className="tabular-nums">{count}</span>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">{t("nothing")}</p>
        )}
      </div>
    </div>
  );
}
