"use client";

import Image from "next/image";
import Link from "next/link";
import { useTranslations } from "next-intl";

import { cn } from "@/lib/utils";
import type { MapRead } from "@/types/map.types";

import type { MapPoolView } from "../_hooks/useTournamentMapPool";

export type MapPoolCardProps = {
  pool: MapPoolView;
  /** The `maps` section this card opens. */
  href: string;
  /**
   * How many thumbnails to show before the "+N" tile. Five by default: with
   * the tile that is six cells, so the three-column grid closes on exactly two
   * rows instead of leaving a third row holding one "+N".
   */
  preview?: number;
  id?: string;
  className?: string;
};

/**
 * The overview's map-pool teaser: a strip of map pictures that IS the link
 * into the Maps section.
 *
 * Its predecessor was a `<details>` disclosure with a line of per-mode counts,
 * and nothing about it said "there is a whole section behind this" — the whole
 * card is now one anchor with the section arrow in its heading.
 */
export function MapPoolCard({
  pool,
  href,
  preview = 5,
  id,
  className
}: Readonly<MapPoolCardProps>) {
  const t = useTranslations();

  if (pool.total === 0) return null;

  const maps: MapRead[] = pool.byGamemode.flatMap((group) => group.maps);
  // The "+N" tile costs a cell, so hiding a single map to advertise it would
  // trade a picture for the word "+1".
  const shown = maps.slice(0, maps.length <= preview + 1 ? preview + 1 : preview);
  const rest = maps.length - shown.length;

  return (
    <Link
      id={id}
      href={href}
      className={cn(
        "group block scroll-mt-28 no-underline",
        className
      )}
    >
      <span className="mb-2 flex items-baseline justify-between gap-3">
        <span className="aqt-mono text-[12px] uppercase tracking-[0.06em] text-[color:var(--aqt-fg-faint)]">
          {t("tournamentDetail.mapPool.title", { count: pool.total })}
        </span>
        <span className="font-mono text-[11px] text-[color:var(--aqt-fg-muted)] transition-colors group-hover:text-[color:var(--aqt-teal)]">
          {t("tournamentDetail.mapPool.open")} →
        </span>
      </span>
      <span className="grid grid-cols-3 gap-1.5">
        {shown.map((map) => (
          <span
            key={map.id}
            className="relative block aspect-video overflow-hidden rounded border border-[color:var(--aqt-border)] bg-[color:var(--aqt-overlay-1)] transition-colors group-hover:border-[color:var(--aqt-teal)]"
            title={map.name}
          >
            {map.image_path ? (
              <Image src={map.image_path} alt="" fill sizes="120px" className="object-cover" />
            ) : null}
          </span>
        ))}
        {rest > 0 ? (
          <span className="aqt-tnum grid aspect-video place-items-center rounded border border-[color:var(--aqt-border)] font-mono text-[12px] text-[color:var(--aqt-fg-muted)]">
            +{rest}
          </span>
        ) : null}
      </span>
    </Link>
  );
}

export default MapPoolCard;
