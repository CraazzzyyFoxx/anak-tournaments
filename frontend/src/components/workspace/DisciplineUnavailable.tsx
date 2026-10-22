"use client";

import type { ReactNode } from "react";
import { useTranslations } from "next-intl";

import { PageStateCard } from "@/components/ui/page-state-card";
import type { PageGame } from "@/lib/site/discipline-scope";

/**
 * What a page shows instead of game data (spec §4.1): an `invalid` request is named, never
 * corrected, with the page's own way out as `action`; `empty` means the area runs no game.
 * `headingLevel={1}` where the state stands in for the whole page (see `PageStateCard`).
 */
export function DisciplineUnavailable({
  game,
  action,
  headingLevel
}: Readonly<{
  game: Extract<PageGame, { kind: "invalid" | "empty" }>;
  action?: ReactNode;
  headingLevel?: 1 | 2;
}>) {
  const t = useTranslations("common.discipline");
  if (game.kind === "empty") {
    return (
      <PageStateCard state="empty" headingLevel={headingLevel} title={t("emptyTitle")} description={t("empty")} />
    );
  }
  return (
    <div className="space-y-3">
      <PageStateCard
        state="error"
        headingLevel={headingLevel}
        title={t("invalidTitle")}
        description={t(`invalid.${game.reason}`, { requested: game.requested })}
      />
      {action ? <div className="flex justify-center">{action}</div> : null}
    </div>
  );
}
