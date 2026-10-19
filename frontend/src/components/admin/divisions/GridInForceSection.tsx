"use client";

import type { ReactNode } from "react";
import { useTranslations } from "next-intl";

import type { Band, Ladder } from "@/app/admin/settings/divisions/editor/draftReducer";
import { LadderBar } from "@/app/admin/settings/divisions/LadderBar";
import { EYEBROW_CLASS } from "@/components/kit/tone";
import { useFormatter } from "@/lib/datetime/client";
import { cn } from "@/lib/utils";
import type { DivisionGridVersion } from "@/types/workspace.types";

import { MONO_CAPTION } from "./model";

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
  const hasNativeLadder = ladder !== null;

  return (
    <section
      aria-labelledby="divisions-in-force"
      className={cn(
        "rounded-xl p-4 sm:p-5",
        activeVersion
          ? "border border-primary/30 bg-primary/5"
          : "border border-dashed border-border"
      )}
    >
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <p className={cn(EYEBROW_CLASS, activeVersion && "text-primary/80")}>
            {activeVersion
              ? t("inForceVersion", { version: activeVersion.version })
              : t("inForce")}
          </p>
          <h2
            id="divisions-in-force"
            className="mt-1 font-display text-2xl font-semibold leading-tight tracking-tight"
          >
            {activeVersion
              ? activeVersion.label
              : t(hasNativeLadder ? "builtInLadder" : "gridRequired")}
          </h2>
          <p className={cn(MONO_CAPTION, "mt-1.5")}>
            {activeVersion
              ? [
                  `${bands.length} divisions`,
                  ladder ? `${ladder.count} ranks` : null,
                  activeVersion.published_at
                    ? `published ${format.dateTime(new Date(activeVersion.published_at), {
                        dateStyle: "medium"
                      })}`
                    : null,
                  activeIsShared ? "shared grid" : null,
                  systemFallback ? t("systemFallback") : null
                ]
                  .filter(Boolean)
                  .join(" · ")
              : ladder
                ? `${ladder.count} ranks · nothing activated`
                : t("noActiveVersion")}
          </p>
        </div>
        {nextAction ? (
          <div className="flex shrink-0 flex-col items-start gap-1.5 lg:items-end">
            <span className={EYEBROW_CLASS}>{t("nextStep")}</span>
            {nextAction}
          </div>
        ) : null}
      </div>

      {ladder ? (
        <LadderBar
          ladder={ladder}
          bands={bands}
          size="lg"
          tone={activeVersion ? "accent" : "neutral"}
          className="mt-4"
        />
      ) : null}

      <p className="mt-3 max-w-prose text-xs text-muted-foreground">
        {activeVersion
          ? activeIsShared
            ? t("activeShared")
            : t("activeDescription", { version: activeVersion.version })
          : t(hasNativeLadder ? "inactiveDescription" : "organizerGridRequired")}
      </p>
    </section>
  );
}
