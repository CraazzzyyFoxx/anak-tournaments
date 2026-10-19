"use client";

import { useTranslations } from "next-intl";

import type { DraftSeedResponse } from "@/types/draft.types";

/** Before → after counts in the re-seed confirmation: what committing the seed replaces. */
export function DraftReseedDiff({ diff }: Readonly<{ diff: DraftSeedResponse["diff"] }>) {
  const t = useTranslations("draftAdmin");
  const tAdmin = useTranslations("adminTournament.draft");
  return (
    <div className="mt-3 grid grid-cols-3 gap-2 rounded-xl bg-muted/50 p-3 text-center text-sm tabular-nums">
      <div>
        {tAdmin("diff", {
          label: t("teams"),
          before: diff.teams_before,
          after: diff.teams_after
        })}
      </div>
      <div>
        {tAdmin("diff", {
          label: t("players"),
          before: diff.players_before,
          after: diff.players_after
        })}
      </div>
      <div>
        {tAdmin("diff", {
          label: t("picks"),
          before: diff.picks_before,
          after: diff.picks_after
        })}
      </div>
    </div>
  );
}
