"use client";

import Image from "next/image";
import { useTranslations } from "next-intl";

import { cn } from "@/lib/utils";

import {
  bandIconUrl,
  ladderOwners,
  nativeRangeLabel,
  rankLabel,
  type Band,
  type Ladder
} from "./editor/draftReducer";

export interface LadderBarProps {
  /** The discipline's native ladder the bar is cut over; callers render the bar only for disciplines that have one. */
  ladder: Ladder;
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
 * The native ladder as one bar, cut where the version sends each rank: a
 * segment per division, as wide as the native ranks that land in it,
 * alternating two tints so every boundary reads. Ranks no division takes are
 * a dashed warning segment; a division no native rank reaches has no width here.
 */
export function LadderBar({
  ladder,
  bands,
  size = "sm",
  tone = "neutral",
  className
}: Readonly<LadderBarProps>) {
  const t = useTranslations("adminSettings.divisions");
  const [even, odd] = SEGMENT_TONE[tone];
  const large = size === "lg";

  const segments: { owner: number | null; from: number; size: number }[] = [];
  ladderOwners(ladder, bands).forEach((owner, rank) => {
    const last = segments[segments.length - 1];
    if (last && last.owner === owner) last.size += 1;
    else segments.push({ owner, from: rank, size: 1 });
  });

  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <ol
        aria-label={t("ladderBarLabel", { divisions: bands.length, ranks: ladder.count })}
        className={cn("flex w-full gap-px", large ? "h-9" : "h-1.5")}
      >
        {segments.map((segment) => {
          const band = segment.owner === null ? null : bands[segment.owner];
          const crest = band ? bandIconUrl(ladder, band) : null;
          return (
            <li
              key={segment.from}
              style={{ flexGrow: segment.size }}
              title={
                band
                  ? t("ladder.bandTitle", {
                      number: band.number,
                      name: band.name,
                      range: nativeRangeLabel(ladder, band) ?? t("ladder.notLinked")
                    })
                  : t("ladder.noDivisionTitle", {
                      range:
                        segment.size > 1
                          ? `${rankLabel(ladder, segment.from)} – ${rankLabel(ladder, segment.from + segment.size - 1)}`
                          : rankLabel(ladder, segment.from)
                    })
              }
              className={cn(
                "flex min-w-0 basis-0 items-center justify-center overflow-hidden",
                large ? "rounded-sm" : "rounded-[1px]",
                band === null
                  ? "border border-dashed border-warning/70 bg-warning/10"
                  : segment.owner! % 2 === 0
                    ? even
                    : odd
              )}
            >
              {/* Below `lg` a one-rank segment is a few pixels wide: the crest would be a
                  sliver, so the cut alone carries the bar there. */}
              {large && crest ? (
                <Image
                  src={crest}
                  alt=""
                  width={20}
                  height={20}
                  unoptimized
                  className="hidden size-5 max-w-full object-contain lg:block"
                />
              ) : null}
            </li>
          );
        })}
      </ol>
      {large ? (
        <div
          aria-hidden
          className="flex justify-between font-mono text-label uppercase tracking-wider text-muted-foreground"
        >
          <span>{rankLabel(ladder, 0)}</span>
          <span>{rankLabel(ladder, ladder.last)}</span>
        </div>
      ) : null}
    </div>
  );
}
