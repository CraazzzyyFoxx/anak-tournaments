"use client";

import React from "react";

import { AvatarStack } from "@/components/ui/avatar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useHoverIntent } from "@/hooks/useHoverIntent";
import { catalogInitials } from "@/lib/catalog/initials";
import { cn } from "@/lib/utils";
import type { CatalogEntityRead } from "@/types/catalog.types";

export type CatalogEntityImageSize = "sm" | "md" | "lg";

const SIZE_PX: Record<CatalogEntityImageSize, number> = { sm: 26, md: 30, lg: 40 };

/** What the image reads from an entity: enough for embedded relationships that carry only these fields. */
type ImageEntity = Pick<CatalogEntityRead, "name" | "image_path">;

interface CatalogEntityImageProps {
  /** `null` renders the neutral placeholder (an unresolved or missing reference). */
  entity: ImageEntity | null;
  /** Named size ("sm" | "md" | "lg") or an explicit pixel size. */
  size?: CatalogEntityImageSize | number;
  /** Next to its own name in the surrounding text: hide it from assistive technology instead of repeating the name. */
  decorative?: boolean;
  className?: string;
  title?: string;
  rounded?: "full" | "lg";
  /** Hover/focus content (a statistics card); makes the image an interactive trigger. */
  popover?: React.ReactNode;
}

/**
 * Portrait of a character, map or mode of any discipline, with an initials fallback on a neutral tile. It paints
 * the entity only: it never derives a player's assigned role (or its colour) from a character's `class`.
 *
 * Deliberately a plain `<img loading="lazy">`, not Radix `AvatarImage` (which preloads regardless of `loading`; one
 * screen can carry dozens of portraits) and not `next/image` (the optimizer shares the site's single Node process).
 */
export default function CatalogEntityImage({
  entity,
  size = "md",
  decorative = false,
  className,
  title,
  rounded = "full",
  popover
}: Readonly<CatalogEntityImageProps>) {
  const px = typeof size === "number" ? size : SIZE_PX[size];
  const radiusClass = rounded === "full" ? "rounded-full" : "rounded-md";
  const src = entity?.image_path || null;
  // Keyed by src so a row recycled onto another entity re-tries its portrait.
  const [brokenSrc, setBrokenSrc] = React.useState<string | null>(null);
  const showImage = src !== null && brokenSrc !== src;
  const name = entity?.name ?? "";

  const tile = (
    <span
      className={cn(
        "relative flex shrink-0 overflow-hidden border border-[color:var(--aqt-border-2)]",
        radiusClass,
        className
      )}
      style={{ width: px, height: px }}
      title={decorative ? undefined : (title ?? (name || undefined))}
      aria-hidden={decorative || entity === null ? true : undefined}
    >
      {showImage ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt={decorative ? "" : name}
          width={px}
          height={px}
          loading="lazy"
          decoding="async"
          onError={() => setBrokenSrc(src)}
          className={cn("h-full w-full select-none object-contain", radiusClass)}
        />
      ) : (
        <span
          className={cn("aqt-display flex h-full w-full items-center justify-center font-extrabold", radiusClass)}
          // Initials stand in for the portrait, so they hold the 11px floor rather than scaling below it.
          style={{
            fontSize: Math.max(11, Math.round(px * 0.4)),
            color: "var(--aqt-fg-muted)",
            background: "var(--aqt-card-2)"
          }}
        >
          {catalogInitials(name)}
        </span>
      )}
    </span>
  );

  if (!popover) return tile;
  return <HoverPopover trigger={tile} content={popover} label={name || undefined} />;
}

/**
 * Popover with mouse hover-intent (opens on hover, stays open while the cursor moves into the content, closes after a
 * short delay on leave) and keyboard focus: the trigger is a real button, labelled by the entity's name.
 */
function HoverPopover({
  trigger,
  content,
  label
}: Readonly<{ trigger: React.ReactNode; content: React.ReactNode; label?: string }>) {
  const { open, setOpen, cancel, scheduleOpen, scheduleClose } = useHoverIntent({ closeDelay: 120, exclusive: true });

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={label}
          // Hover brightens a ring rather than scaling: a size change on hover shifts neighbours in an avatar stack.
          className="inline-flex appearance-none rounded-full border-0 bg-transparent p-0 leading-none transition-shadow hover:ring-2 hover:ring-[color:color-mix(in_srgb,var(--aqt-teal)_45%,transparent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--aqt-teal)]"
          onPointerEnter={(e) => {
            if (e.pointerType === "mouse") scheduleOpen();
          }}
          onPointerLeave={(e) => {
            if (e.pointerType === "mouse") scheduleClose();
          }}
          onFocus={() => scheduleOpen(0)}
          onBlur={() => scheduleClose(0)}
        >
          {trigger}
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="w-80"
        animate={false}
        onOpenAutoFocus={(e) => e.preventDefault()}
        onPointerEnter={(e) => {
          if (e.pointerType === "mouse") cancel();
        }}
        onPointerLeave={(e) => {
          if (e.pointerType === "mouse") scheduleClose();
        }}
      >
        {content}
      </PopoverContent>
    </Popover>
  );
}

/**
 * Several entities as one overlapping stack (a player's characters), collapsing to "+N" after `limit`. Each portrait
 * may carry its own hover card through `renderPopover`.
 */
export function CatalogEntityStrip<E extends ImageEntity>({
  entities,
  size = "sm",
  limit = 5,
  className,
  renderPopover
}: Readonly<{
  entities: readonly E[];
  size?: CatalogEntityImageSize | number;
  limit?: number;
  className?: string;
  renderPopover?: (entity: E, index: number) => React.ReactNode;
}>) {
  return (
    <AvatarStack max={limit} size={typeof size === "number" ? size : SIZE_PX[size]} className={className}>
      {entities.map((entity, index) => (
        <CatalogEntityImage
          key={`${entity.name}-${index}`}
          entity={entity}
          size={size}
          popover={renderPopover?.(entity, index)}
        />
      ))}
    </AvatarStack>
  );
}
