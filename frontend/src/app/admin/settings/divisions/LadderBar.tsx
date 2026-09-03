"use client";

import Image from "next/image";

import { cn } from "@/lib/utils";

import {
  bandIconUrl,
  bandRangeLabel,
  bandSize,
  RANK_COUNT,
  rankLabel,
  type Band
} from "./editor/draftReducer";

export interface LadderBarProps {
  bands: Band[];
  /** `lg` is the hero: crest per band and the ladder's two end labels. `sm` is the hairline in a version row. */
  size?: "sm" | "lg";
  /** Teal for the version in force, grey for every other one. */
  tone?: "accent" | "neutral";
  className?: string;
}

const SEGMENT_TONE = {
  accent: ["bg-primary/25", "bg-primary/45"],
  neutral: ["bg-foreground/[0.10]", "bg-foreground/[0.22]"]
} as const;

/**
 * The 45-rank Overwatch ladder as one bar, cut where the version cuts it.
 *
 * A version *is* a partition of the ladder, so this is the version drawn
 * rather than described: a segment per division, as wide as the ranks it owns,
 * alternating two tints so every boundary reads. Two versions with the same
 * division count but different cuts look different here and identical in a
 * "20 divisions" caption — which is why the history rows carry it too.
 */
export function LadderBar({
  bands,
  size = "sm",
  tone = "neutral",
  className
}: Readonly<LadderBarProps>) {
  const [even, odd] = SEGMENT_TONE[tone];
  const large = size === "lg";

  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <ol
        aria-label={`${bands.length} divisions over ${RANK_COUNT} ranks`}
        className={cn("flex w-full gap-px", large ? "h-9" : "h-1.5")}
      >
        {bands.map((band, index) => (
          <li
            key={band.slug}
            style={{ flexGrow: bandSize(band) }}
            title={`${band.number} · ${band.name} — ${bandRangeLabel(band)}`}
            className={cn(
              "flex min-w-0 basis-0 items-center justify-center overflow-hidden",
              large ? "rounded-sm" : "rounded-[1px]",
              index % 2 === 0 ? even : odd
            )}
          >
            {/* Below `lg` a one-rank segment is a few pixels wide: the crest would be a
                sliver, so the cut alone carries the bar there. */}
            {large ? (
              <Image
                src={bandIconUrl(band)}
                alt=""
                width={20}
                height={20}
                unoptimized
                className="hidden size-5 max-w-full object-contain lg:block"
              />
            ) : null}
          </li>
        ))}
      </ol>
      {large ? (
        <div
          aria-hidden
          className="flex justify-between font-mono text-[11px] uppercase tracking-wider text-muted-foreground"
        >
          <span>{rankLabel(0)}</span>
          <span>{rankLabel(RANK_COUNT - 1)}</span>
        </div>
      ) : null}
    </div>
  );
}
