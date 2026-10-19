"use client";

import { useTranslations } from "next-intl";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { SlotProps } from "@/disciplines/types";
import { observedScore } from "@/lib/encounter/detail";
import { formatOverperformance, ordinal, overperformanceBadge, resolveMvpPlacement } from "./mvp";

/** Gold only for 1st, every other placement neutral (design-book MVP rule). */
const RankLine = ({ label, rank }: { label: string; rank: number | null | undefined }) => (
  <div className="flex items-center justify-between gap-3">
    <span className="text-muted-foreground">{label}</span>
    <span
      className="aqt-tnum font-semibold"
      style={{ color: rank === 1 ? "var(--aqt-gold)" : "var(--aqt-fg-faint)" }}
    >
      {rank != null ? ordinal(rank) : "—"}
    </span>
  </div>
);

/**
 * Profile-local MVP placement: a plain ordinal (no chip) that opens the same
 * breakdown card as elsewhere — new impact rank, legacy rank, overperformance.
 * Reads the viewer's whole-match facts. Must be rendered inside a `TooltipProvider`.
 */
export default function MvpOrdinal({ match }: Readonly<SlotProps["matchRowBadge"]>) {
  const t = useTranslations();
  const facts = match.viewer?.facts;
  const placement = resolveMvpPlacement(facts);
  if (placement == null) return null;

  const over = formatOverperformance(facts?.overperformance_score);
  // Top of the match by overperformance and past the threshold: the "above expectations" row is the badge.
  const badge = overperformanceBadge(match);
  const scores = match.participants.map((participant) => observedScore(participant) ?? "—");

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className="aqt-tnum cursor-default text-ui font-bold"
          style={{ color: placement === 1 ? "var(--aqt-gold)" : "var(--aqt-fg-faint)" }}
        >
          {ordinal(placement)}
        </span>
      </TooltipTrigger>
      <TooltipContent
        align="start"
        className="w-60 overflow-hidden border bg-popover p-0 text-popover-foreground shadow-md"
      >
        <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
          <span className="truncate text-caption font-semibold text-foreground">
            {match.map.name}
          </span>
          <span className="aqt-tnum shrink-0 text-label text-muted-foreground">
            {scores.join(" – ")}
          </span>
        </div>
        <div className="flex flex-col gap-2 px-3 py-2.5 text-caption">
          <RankLine label={t("users.matches.mvp.newRank")} rank={facts?.impact_rank} />
          <RankLine label={t("users.matches.mvp.oldRank")} rank={facts?.performance} />
          {over ? (
            <div className="flex items-center justify-between gap-3">
              <span className={badge ? "font-semibold text-foreground" : "text-muted-foreground"}>
                {t("users.matches.overperformanceBadge")}
              </span>
              <span
                className="aqt-tnum font-semibold"
                style={{ color: over.raised ? "var(--aqt-emerald)" : "var(--aqt-rose)" }}
              >
                {over.text}
              </span>
            </div>
          ) : null}
        </div>
      </TooltipContent>
    </Tooltip>
  );
}
