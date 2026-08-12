"use client";

import Image from "next/image";

import HeroImage from "@/components/hero/HeroImage";
import { cn } from "@/lib/utils";
import type { PickBanKind } from "@/types/tournament.types";

import type { PickBanItemLike } from "./PickBanGrid";

interface PickBanItemThumbProps {
  kind: PickBanKind;
  /** Undefined while the catalog is still loading — falls back to initials. */
  item: PickBanItemLike | undefined;
  /** Name to render/announce; the room resolves the `#id` fallback. */
  name: string;
  /** Square edge in px. Maps render 4:3 at `size` tall, heroes a circle. */
  size?: number;
  /** Greys the art out — a banned item, a round that has not opened. */
  muted?: boolean;
}

/**
 * One pool item at a glance: a hero portrait or a map still, wherever the room
 * would otherwise print the item's name as bare text (step timeline, play
 * order, the command bar's confirmation). Heroes go through `HeroImage` — the
 * app's canonical hero renderer, initials fallback included — so only the map
 * shape is implemented here.
 */
export function PickBanItemThumb({ kind, item, name, size = 28, muted }: PickBanItemThumbProps) {
  if (kind === "hero") {
    return (
      <HeroImage
        hero={{ name, image_path: item?.image_path ?? "", role: item?.role ?? "" }}
        size={size}
        title={name}
        className={cn("shrink-0", muted ? "opacity-45 grayscale" : null)}
      />
    );
  }

  // 4:3 keeps map stills readable at rail scale; a bare square crops them to
  // an unrecognisable patch of skybox.
  const width = Math.round((size * 4) / 3);
  return (
    <span
      title={name}
      className={cn(
        // `inline-block`, not bare `inline`: an inline span ignores width/height,
        // so the tile only ever had a size when a flex parent blockified it.
        "relative inline-block shrink-0 overflow-hidden rounded-md bg-[color:var(--aqt-card-2)] align-middle ring-1 ring-inset ring-[color:var(--aqt-border-2)]",
        muted ? "opacity-45 grayscale" : null
      )}
      style={{ width, height: size }}
    >
      {item?.image_path ? (
        <Image src={item.image_path} alt="" fill sizes={`${width}px`} className="object-cover" />
      ) : (
        <span
          aria-hidden
          className="absolute inset-0 grid place-items-center font-onest font-bold text-[color:var(--aqt-fg-faint)]"
          style={{ fontSize: Math.max(9, Math.round(size * 0.4)) }}
        >
          {name.slice(0, 2).toUpperCase()}
        </span>
      )}
    </span>
  );
}
