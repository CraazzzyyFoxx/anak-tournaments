"use client";

import { ArrowDown, ArrowUp } from "lucide-react";
import { useTranslations } from "next-intl";

import { cn } from "@/lib/utils";

/** Up/down colour of a forecast move (DESIGN.md §2: `--aqt-up` so a gain never reads as the support role). */
export function moveTone(delta: number | null | undefined): string {
  if (delta == null || delta === 0) return "var(--aqt-fg-dim)";
  return delta > 0 ? "var(--aqt-up)" : "var(--aqt-rose)";
}

interface DeltaTextProps {
  /** predicted_place − actual_place; + = finished better than forecast, − = worse. */
  delta: number | null;
  className?: string;
}

/** A team's place against its forecast as coloured text: `↑ +11`, `↓ −6`, or a muted "on form". */
export default function DeltaText({ delta, className }: Readonly<DeltaTextProps>) {
  const t = useTranslations();
  if (delta == null) return null;

  if (delta === 0) {
    return (
      <span className={cn("text-caption text-[color:var(--aqt-fg-dim)]", className)}>
        {t("analytics.community.standings.onForm")}
      </span>
    );
  }

  const Icon = delta > 0 ? ArrowUp : ArrowDown;
  return (
    <span
      className={cn("aqt-tnum inline-flex items-center gap-0.5 text-caption font-semibold", className)}
      style={{ color: moveTone(delta) }}
    >
      <Icon aria-hidden className="size-3.5" />
      {delta > 0 ? "+" : "−"}
      {Math.abs(delta)}
    </span>
  );
}
