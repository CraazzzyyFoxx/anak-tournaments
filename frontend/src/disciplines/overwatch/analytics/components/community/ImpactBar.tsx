"use client";

import { useTranslations } from "next-intl";

import { getImpactColor } from "@/lib/colors";
import { cn } from "@/lib/utils";

interface ImpactBarProps {
  /** 0–100 impact / percentile. */
  value: number;
  /** The number beside the bar; off where the same figure is already printed above it. */
  showValue?: boolean;
  className?: string;
}

/** The 0–100 impact as a DESIGN.md §8 bar: `h-1.5` track, quality-coloured fill, the exact value beside it. */
export default function ImpactBar({ value, showValue = true, className }: Readonly<ImpactBarProps>) {
  const t = useTranslations();
  const clamped = Math.max(0, Math.min(100, value));
  const color = getImpactColor(clamped);
  return (
    <span className={cn("flex items-center gap-2", className)}>
      <span
        role="progressbar"
        aria-label={t("analytics.community.player.impact")}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={clamped}
        className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-[color:var(--aqt-card-2)]"
      >
        <span className="block h-full rounded-full" style={{ width: `${clamped}%`, background: color }} />
      </span>
      {showValue ? (
        <span className="aqt-tnum w-6 shrink-0 text-right text-caption font-semibold" style={{ color }}>
          {clamped}
        </span>
      ) : null}
    </span>
  );
}
