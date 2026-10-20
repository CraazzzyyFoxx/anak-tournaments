"use client";

import type { ReactNode } from "react";
import { useTranslations } from "next-intl";

import { PageStateCard } from "@/components/ui/page-state-card";
import type { PageGame } from "@/lib/site/discipline-scope";

/**
 * What a page shows instead of game data (spec §4.1): an `invalid` request is named, never
 * corrected, with the page's own way out as `action`; `empty` means the area runs no game.
 */
export function DisciplineUnavailable({
  game,
  action
}: Readonly<{ game: Extract<PageGame, { kind: "invalid" | "empty" }>; action?: ReactNode }>) {
  const t = useTranslations("common.discipline");
  if (game.kind === "empty") {
    return <PageStateCard state="empty" title={t("emptyTitle")} description={t("empty")} />;
  }
  return (
    <div className="space-y-3">
      <PageStateCard
        state="error"
        title={t("invalidTitle")}
        description={t(`invalid.${game.reason}`, { requested: game.requested })}
      />
      {action ? <div className="flex justify-center">{action}</div> : null}
    </div>
  );
}
