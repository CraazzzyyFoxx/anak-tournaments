"use client";

import { useState } from "react";
import Image from "next/image";

import { cn } from "@/lib/utils";
import type { Achievement } from "@/types/achievement.types";

interface AchievementArtProps {
  achievement: Pick<Achievement, "name" | "slug" | "image_url">;
  /** `next/image` sizes hint for the rendered box. */
  sizes: string;
  /** Box classes (size, radius, positioning). The box is always `relative overflow-hidden`. */
  className?: string;
  imgClassName?: string;
  /** Empty by default: every call site prints the name next to (or over) the art. */
  alt?: string;
}

/**
 * Badge art with a designed fallback. Rules without an uploaded image fall back
 * to `/achievements/<slug>.webp`, and that file often does not exist (the path
 * then hits the `/achievements/[id]` route and errors), so a failed load
 * swaps in a monogram panel tinted by the nearest `--rar` (`.aqt-rar-*`)
 * instead of leaving a broken image with spilled alt text.
 */
export function AchievementArt({ achievement, sizes, className, imgClassName, alt = "" }: AchievementArtProps) {
  const src = achievement.image_url ?? `/achievements/${achievement.slug}.webp`;
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const failed = failedSrc === src;

  return (
    <span className={cn("relative block overflow-hidden bg-[color:var(--aqt-card-2)] [container-type:inline-size]", className)}>
      {failed ? (
        <span
          aria-hidden
          className="absolute inset-0 grid place-items-center font-onest font-bold uppercase leading-none text-[40cqw]"
          style={{
            color: "hsl(var(--rar, 215 14% 60%) / 0.75)",
            background:
              "radial-gradient(120% 90% at 30% 15%, hsl(var(--rar, 215 14% 60%) / 0.26), transparent 65%), var(--aqt-card-2, transparent)"
          }}
        >
          {Array.from(achievement.name.trim())[0] ?? "?"}
        </span>
      ) : (
        <Image
          src={src}
          alt={alt}
          fill
          sizes={sizes}
          className={cn("object-cover", imgClassName)}
          // A server-rendered <img> can fail before hydration attaches onError;
          // the ref sees that already-broken state on mount.
          ref={(img) => {
            if (img?.complete && img.naturalWidth === 0) setFailedSrc(src);
          }}
          onError={() => setFailedSrc(src)}
        />
      )}
    </span>
  );
}
