"use client";

import { useTranslations } from "next-intl";

import type { AdminRegistration } from "@/types/balancer-admin.types";
import type { DraftFormat } from "@/types/draft.types";

import { buildDraftSchedule } from "./setup-model";
import { registrationLabel } from "./setup-types";

interface DraftSetupPreviewProps {
  orderedCaptainIds: number[];
  pool: AdminRegistration[];
  rounds: number;
  format: DraftFormat;
  roundRules: string[];
}

export function DraftSetupPreview({
  orderedCaptainIds,
  pool,
  rounds,
  format,
  roundRules
}: Readonly<DraftSetupPreviewProps>) {
  const t = useTranslations("draftAdmin");
  const schedule = buildDraftSchedule(orderedCaptainIds, rounds, format, roundRules);

  return (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold">{t("schedulePreview")}</h3>
      <ol className="divide-y divide-border">
        {schedule.map((entry) => (
          <li key={entry.round} className="flex min-w-0 items-baseline gap-3 py-2">
            <span className="w-16 shrink-0 text-xs font-medium tabular-nums text-muted-foreground">
              {t("roundNumber", { round: entry.round })}
            </span>
            {entry.resolved ? (
              <span className="min-w-0 flex-1 text-sm">
                {entry.teamIds
                  .map((id) => {
                    const registration = pool.find((candidate) => candidate.id === id);
                    return registration ? registrationLabel(registration) : `#${id}`;
                  })
                  .join(" · ")}
              </span>
            ) : (
              /* Showing the seed order here would promise an order the draft will
                 not follow: this rule is resolved server-side. Name it instead. */
              <span className="min-w-0 flex-1 text-xs text-muted-foreground">
                {t(`rules.${entry.rule}`)} · {t("orderResolvedOnTheServer")}
              </span>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}
