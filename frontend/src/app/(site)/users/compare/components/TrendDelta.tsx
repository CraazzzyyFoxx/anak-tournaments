"use client";

import { Minus, TrendingDown, TrendingUp } from "lucide-react";

import { formatMetricValue, formatPercent } from "@/app/(site)/users/compare/utils";

interface TrendDeltaProps {
  delta: number | null;
  deltaPercent: number | null;
  betterWorse?: "better" | "worse" | "equal" | null;
}

const TrendDelta = ({ delta, deltaPercent, betterWorse }: TrendDeltaProps) => {
  if (delta === null || !Number.isFinite(delta)) {
    return <span className="text-[color:var(--aqt-fg-dim)]">-</span>;
  }

  if (betterWorse === null || betterWorse === undefined) {
    return <span className="text-[color:var(--aqt-fg-dim)]">-</span>;
  }

  if (betterWorse === "equal") {
    return (
      <span className="aqt-tnum inline-flex items-center gap-1 text-caption text-[color:var(--aqt-fg-dim)]">
        <Minus className="h-3.5 w-3.5" aria-hidden />
        <span className="tabular-nums">
          {formatMetricValue(delta)}
          {deltaPercent !== null ? ` (${formatPercent(deltaPercent)})` : ""}
        </span>
      </span>
    );
  }

  const isBetter = betterWorse === "better";
  const Icon = isBetter ? TrendingUp : TrendingDown;

  return (
    <span
      className="aqt-tnum inline-flex items-center gap-1 text-caption font-semibold tabular-nums"
      style={{ color: isBetter ? "var(--aqt-emerald)" : "var(--aqt-rose)" }}
    >
      <Icon className="h-3.5 w-3.5" aria-hidden />
      <span className="tabular-nums">
        {formatMetricValue(delta)}
        {deltaPercent !== null ? ` (${formatPercent(deltaPercent)})` : ""}
      </span>
    </span>
  );
};

export default TrendDelta;
