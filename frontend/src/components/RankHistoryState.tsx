"use client";

import type { LucideIcon } from "lucide-react";

import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

const CARD_CLASS =
  "relative overflow-hidden rounded-xl border border-[color:var(--aqt-border)] bg-[color:var(--aqt-card)] p-4 shadow-inner";

/**
 * The "nothing to draw" surface for rank-history cards.
 *
 * Deliberately not `<PageStateCard>`: that is a page-level surface (px-6 py-10,
 * section type scale) whereas these states render *inside* a chart card — a
 * 300px sheet column and a table's expanded row — where it would dwarf the
 * chart it stands in for. It also keeps the per-state iconography that tells
 * "no history at all" apart from "nothing for this filter".
 */
export function ChartEmptyState({
  icon: Icon,
  title,
  body,
  tone = "neutral",
  className
}: Readonly<{
  icon: LucideIcon;
  title: string;
  body: string;
  /** `error` announces assertively and accents the icon. */
  tone?: "neutral" | "error";
  className?: string;
}>) {
  const isError = tone === "error";
  return (
    <div
      role={isError ? "alert" : "status"}
      className={cn(
        "flex flex-col items-center justify-center rounded-xl border p-6 text-center",
        isError
          ? "border-[color:var(--aqt-rose)]/25 bg-[color:var(--aqt-rose)]/5"
          : "border-[color:var(--aqt-border)] bg-[color:var(--aqt-overlay-1)]",
        className
      )}
    >
      <Icon
        aria-hidden
        className={cn(
          "mb-2 h-5 w-5",
          isError ? "text-[color:var(--aqt-rose)]" : "text-[color:var(--aqt-fg-faint)]"
        )}
      />
      <h4 className="mb-1 text-xs font-semibold text-[color:var(--aqt-fg)]">{title}</h4>
      <p className="max-w-xs text-label leading-normal text-[color:var(--aqt-fg-muted)]">{body}</p>
    </div>
  );
}

export function RankHistorySkeleton({ className }: Readonly<{ className?: string }>) {
  return (
    <div className={cn("space-y-3", className)}>
      <div className="flex flex-wrap items-center gap-3">
        <Skeleton className="w-[130px] h-8 bg-[color:var(--aqt-overlay-2)]" />
        <Skeleton className="w-[170px] h-8 bg-[color:var(--aqt-overlay-2)]" />
      </div>
      <div className={CARD_CLASS}>
        <Skeleton className="h-[180px] w-full bg-[color:var(--aqt-overlay-1)]" />
      </div>
    </div>
  );
}
