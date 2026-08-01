import React from "react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";

interface SparkPoint {
  label: string;
  placement: number;
}

/**
 * Tiny bar chart of tournament placements (lower = better; #1 highlighted).
 *
 * The whole chart is one `role="img"` with the series spelled out in its
 * accessible name. The bars previously carried only a `title`, which no screen
 * reader announces reliably and no touch device can reach at all.
 */
export const PlacementSpark = ({ data, max }: { data: SparkPoint[]; max?: number }) => {
  const t = useTranslations();
  if (!data.length) return null;
  const top = max ?? Math.max(...data.map((d) => d.placement), 1);
  const summary = data.map((d) => `#${d.placement} ${d.label}`).join(", ");
  return (
    <div
      className="aqt-place-spark"
      role="img"
      aria-label={t("common.placementSpark.label", { summary })}
    >
      {data.map((d) => {
        const heightPct = Math.max(6, 100 - (d.placement / top) * 100);
        const cls = d.placement === 1 ? "first" : d.placement <= 3 ? "podium" : "";
        return (
          <div
            key={`${d.label}-${d.placement}`}
            className={cn("aqt-col", cls)}
            title={`#${d.placement} · ${d.label}`}
            aria-hidden
          >
            <span className="aqt-val">#{d.placement}</span>
            <div className="aqt-bar" style={{ height: `${heightPct}%` }} />
            <span className="aqt-lbl">{d.label}</span>
          </div>
        );
      })}
    </div>
  );
};
