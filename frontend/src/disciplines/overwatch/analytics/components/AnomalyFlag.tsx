"use client";

import { Flag } from "lucide-react";
import { useTranslations } from "next-intl";

import { IconTooltip } from "@/components/ui/icon-tooltip";
import { cn } from "@/lib/utils";
import { isAnomalyGlossaryTerm } from "@/disciplines/overwatch/analytics/analytics-glossary";

/** Reason codes the detector emits are localised; legacy raw metric expressions are dropped, never shown. */
const RAW_REASON = /[=<>]|\brule\b|\banomaly\b|\bmethod\b|changepoint|rolling|\bp\d/i;

/**
 * A flag's words: the kind's glossary label and one-line meaning, and the
 * localised reasons. An unknown kind reads as a generic watch flag rather than
 * the raw API value (DESIGN.md §11).
 */
export function useAnomalyCopy(kind: string, reasons: readonly string[] = []) {
  const t = useTranslations();
  const term = isAnomalyGlossaryTerm(kind) ? kind : "watch";
  const label = t(`analytics.glossary.${term}.label`);
  const plain = t(`analytics.glossary.${term}.plain`);
  const shownReasons = reasons
    .map((code): string | null => {
      const trimmed = (code ?? "").trim();
      if (!trimmed) return null;
      const key = `analytics.anomalyReason.${trimmed}`;
      // Runtime reason code: next-intl types keys as literals; the missing-key echo below still runs.
      const localised = t(key as Parameters<typeof t>[0]);
      if (localised !== key) return localised;
      return RAW_REASON.test(trimmed) ? null : trimmed;
    })
    .filter((reason): reason is string => reason !== null);
  return { label, plain, reasons: shownReasons, reasonsLabel: t("analytics.glossary.reasonsLabel") };
}

interface AnomalyFlagProps {
  kind: string;
  reasons?: readonly string[];
  /** The kind's name beside the flag; icon only in rows and table cells. */
  withLabel?: boolean;
  className?: string;
}

/**
 * A watch flag on a player: one warning tone for every kind (the kind is said
 * in words, not in a hue), the meaning and the reasons in the tooltip.
 */
export default function AnomalyFlag({ kind, reasons, withLabel = false, className }: Readonly<AnomalyFlagProps>) {
  const copy = useAnomalyCopy(kind, reasons);
  const hint = (
    <>
      <span className="block">{copy.plain}</span>
      {copy.reasons.length > 0 ? (
        <span className="mt-1.5 block">
          <span className="block font-semibold">{copy.reasonsLabel}</span>
          {copy.reasons.map((reason, index) => (
            <span key={`${reason}-${index}`} className="block">
              {reason}
            </span>
          ))}
        </span>
      ) : null}
    </>
  );

  return (
    <IconTooltip
      label={copy.label}
      hint={hint}
      className={cn("shrink-0 items-center gap-1 text-[color:var(--aqt-amber)]", className)}
    >
      <Flag aria-hidden className="size-3.5" />
      {withLabel ? <span className="text-caption font-medium">{copy.label}</span> : null}
    </IconTooltip>
  );
}
