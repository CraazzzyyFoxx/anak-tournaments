"use client";

import type { ReactNode } from "react";
import { useTranslations } from "next-intl";

import type { Band, Ladder } from "@/app/admin/settings/divisions/editor/draftReducer";
import { LadderBar } from "@/app/admin/settings/divisions/LadderBar";
import { useFormatter } from "@/lib/datetime/client";
import type { DivisionGridVersion } from "@/types/workspace.types";

/** The grid every rank resolves through right now, and the one thing worth doing next. */
export function GridInForceSection({
  ladder,
  activeVersion,
  bands,
  activeIsShared,
  systemFallback,
  nextAction
}: Readonly<{
  ladder: Ladder | null;
  activeVersion: DivisionGridVersion | null;
  /** The active version's divisions, or the game's built-in ladder when nothing is in force. */
  bands: Band[];
  /** The active version belongs to a grid the workspace does not own. */
  activeIsShared: boolean;
  /** Nothing is activated explicitly; the version shown is the resolved system grid. */
  systemFallback: boolean;
  nextAction: ReactNode;
}>) {
  const t = useTranslations("adminSettings.divisions");
  const format = useFormatter();
  const ranks = ladder ? t("ladder.rankCount", { count: ladder.count }) : null;

  const meta = activeVersion
    ? [
        t("inForceVersion", { version: activeVersion.version }),
        t("divisionCount", { count: bands.length }),
        ranks,
        activeVersion.published_at
          ? t("publishedOn", {
              date: format.dateTime(new Date(activeVersion.published_at), { dateStyle: "medium" })
            })
          : null,
        activeIsShared ? t("sharedGrid") : null,
        systemFallback ? t("systemFallback") : null
      ]
    : [ranks, t("noActiveVersion")];

  return (
    <section
      aria-labelledby="divisions-in-force"
      className="flex flex-col gap-4 rounded-xl border border-border bg-card p-4 sm:p-5"
    >
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <h2 id="divisions-in-force" className="text-ui font-semibold text-foreground">
            {activeVersion ? activeVersion.label : t(ladder ? "builtInLadder" : "gridRequired")}
          </h2>
          <p className="mt-1 text-caption text-muted-foreground">
            {meta.filter(Boolean).join(" · ")}
          </p>
        </div>
        {nextAction ? <div className="shrink-0">{nextAction}</div> : null}
      </div>

      {ladder ? (
        <LadderBar
          ladder={ladder}
          bands={bands}
          size="lg"
          tone={activeVersion ? "accent" : "neutral"}
        />
      ) : null}
    </section>
  );
}
