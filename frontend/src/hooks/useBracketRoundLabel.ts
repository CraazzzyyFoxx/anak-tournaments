import { useTranslations } from "next-intl";
import { useCallback } from "react";

import { bracketRoundLabel } from "@/components/bracket-view.helpers";

/** Renders a signed round number as the name the bracket shows for it. */
export type BracketRoundLabelFormatter = (round: number, finalRounds: number[]) => string;

/**
 * The single renderer for a bracket round's name.
 *
 * Every screen that names a round goes through this, so the bracket, the
 * pick-ban scope picker and anything else added later cannot drift into
 * calling the same round "Round 3" in one place and "Grand Final" in another.
 * `finalRounds` comes from `getFinalRounds`.
 */
export function useBracketRoundLabel(): BracketRoundLabelFormatter {
  const t = useTranslations("bracket");

  return useCallback(
    (round: number, finalRounds: number[]) => {
      const label = bracketRoundLabel(round, finalRounds);
      switch (label.key) {
        case "lowerRound":
          return t("lowerRound", { n: String(label.n) });
        case "grandFinal":
          return t("grandFinal");
        case "grandFinalReset":
          return t("grandFinalReset");
        default:
          return t("round", { n: String(label.n) });
      }
    },
    [t]
  );
}
