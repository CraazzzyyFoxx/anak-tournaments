"use client";

import { useTranslations } from "next-intl";

import { cn } from "@/lib/utils";

interface DistributionBarProps<K extends string> {
  /** Segment order, which is also the legend order. */
  order: readonly K[];
  counts: Partial<Record<K, number>> | undefined;
  total: number;
  labels: Record<string, string>;
  /** Solid fill class per key (`bg-success`, …). */
  fills: Record<string, string>;
}

/**
 * Stacked distribution of a collector's population per state, with its colour key.
 *
 * The bar is `aria-hidden`: the legend directly under it repeats every segment
 * as `<label> <count>` text, so the state is never carried by colour alone.
 */
export function DistributionBar<K extends string>({
  order,
  counts,
  total,
  labels,
  fills
}: Readonly<DistributionBarProps<K>>) {
  const tDashboard = useTranslations("adminShell.dashboardExtra");
  const segments = order.flatMap((key) => {
    const count = counts?.[key] ?? 0;
    return count ? [{ key, count }] : [];
  });
  const scale = total || 1;
  return (
    <div className="space-y-2">
      <div aria-hidden className="flex h-2.5 w-full overflow-hidden rounded-full bg-muted/20">
        {segments.map(({ key, count }) => (
          <div
            key={key}
            className={cn("h-full", fills[key])}
            style={{ width: `${(count / scale) * 100}%` }}
            title={tDashboard("statusCountTitle", { label: labels[key], count })}
          />
        ))}
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
        {segments.map(({ key, count }) => (
          <span key={key} className="inline-flex items-center gap-1.5 text-muted-foreground">
            <span aria-hidden className={cn("h-2 w-2 rounded-full", fills[key])} />
            {labels[key]} <span className="tabular-nums text-foreground">{count}</span>
          </span>
        ))}
      </div>
    </div>
  );
}
