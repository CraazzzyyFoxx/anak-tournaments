"use client";

import CatalogEntityImage from "@/components/catalog/CatalogEntityImage";
import { cn } from "@/lib/utils";
import type { PickBanKind } from "@/types/tournament.types";

import type { PickBanItemLike } from "./PickBanGrid";

interface PickBanItemThumbProps {
  kind: PickBanKind;
  /** Undefined while the catalog is still loading — falls back to initials. */
  item: PickBanItemLike | undefined;
  /** Name to render/announce; the room resolves the `#id` fallback. */
  name: string;
  /** Edge in px: a hero's circle, a map's height (the still is 4:3). */
  size?: number;
  /** Greys the art out — a banned item, a round that has not opened. */
  muted?: boolean;
}

/**
 * One pool item at a glance: a character portrait or a map still, wherever the room
 * would otherwise print the item's name as bare text (step timeline, play
 * order, the command bar's confirmation).
 */
export function PickBanItemThumb({ kind, item, name, size = 28, muted }: Readonly<PickBanItemThumbProps>) {
  return (
    <CatalogEntityImage
      entity={{ name, image_path: item?.image_path ?? null }}
      size={size}
      shape={kind === "hero" ? "square" : "wide"}
      title={name}
      className={cn("shrink-0", muted ? "opacity-45 grayscale" : null)}
    />
  );
}
