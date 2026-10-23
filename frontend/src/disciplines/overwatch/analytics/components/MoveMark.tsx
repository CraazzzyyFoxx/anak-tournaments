"use client";

import { ArrowDown, ArrowUp, Minus } from "lucide-react";
import { useTranslations } from "next-intl";

import DivisionIcon from "@/components/DivisionIcon";
import { cn } from "@/lib/utils";
import type { PlayerAnalytics } from "@/types/analytics.types";
import type { DivisionGridVersion } from "@/types/workspace.types";

import { moveTone } from "./DeltaText";

interface MoveMarkProps {
  direction: PlayerAnalytics["predicted_direction"];
  /** The division the model moves the player to; `null` for an unranked player (no crest). */
  target: number | null;
  tournamentGrid?: DivisionGridVersion | null;
  /** The word ("Climb") beside the arrow; off where the column already says it. */
  withWord?: boolean;
  className?: string;
}

/** A player's predicted move as text: arrow, word and the target crest, coloured by direction. No pill (DESIGN.md §4). */
export default function MoveMark({ direction, target, tournamentGrid, withWord = true, className }: Readonly<MoveMarkProps>) {
  const t = useTranslations();

  if (direction === "flat") {
    return (
      <span className={cn("inline-flex items-center gap-1 text-caption text-[color:var(--aqt-fg-dim)]", className)}>
        <Minus aria-hidden className="size-3.5" />
        {t("analytics.community.move.hold")}
      </span>
    );
  }

  const up = direction === "promote";
  const Icon = up ? ArrowUp : ArrowDown;
  const word = up ? t("analytics.community.move.climb") : t("analytics.community.move.drop");
  return (
    <span
      className={cn("inline-flex items-center gap-1 text-caption font-medium", className)}
      style={{ color: moveTone(up ? 1 : -1) }}
    >
      <Icon aria-hidden className="size-3.5" />
      <span className={withWord ? undefined : "sr-only"}>{word}</span>
      <DivisionIcon division={target} tournamentGrid={tournamentGrid} width={22} height={22} tooltip />
    </span>
  );
}
