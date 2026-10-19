"use client";

import Image from "next/image";
import { useState } from "react";

import { cn } from "@/lib/utils";
import type { DisciplineDescriptor } from "@/types/discipline.types";

/**
 * A game's mark (spec §3.8): its module icon, else the monogram of its short name — the
 * `WorkspaceAvatar` pattern for games. Named for assistive tech unless `decorative`, where the
 * game's name already sits next to it.
 */
export function GameMark({
  discipline,
  size = 20,
  className,
  decorative = false
}: Readonly<{
  discipline: Pick<DisciplineDescriptor, "code" | "name" | "short_name" | "icon">;
  size?: number;
  className?: string;
  decorative?: boolean;
}>) {
  // A dead icon falls back to the monogram instead of a broken image.
  const [failed, setFailed] = useState(false);
  const icon = failed ? null : discipline.icon;

  return (
    <span
      role={decorative ? undefined : "img"}
      aria-label={decorative ? undefined : discipline.name}
      aria-hidden={decorative || undefined}
      title={decorative ? undefined : discipline.name}
      className={cn(
        "inline-flex shrink-0 items-center justify-center overflow-hidden rounded-md border border-[color:var(--aqt-border-2)]",
        "bg-[color:var(--aqt-card-2)] font-display font-extrabold leading-none text-[color:var(--aqt-fg-muted)]",
        className
      )}
      style={{ width: size, height: size, fontSize: size * 0.4 }}
    >
      {icon ? (
        <Image
          src={icon}
          alt=""
          width={size}
          height={size}
          unoptimized
          className="size-full object-contain"
          onError={() => setFailed(true)}
        />
      ) : (
        discipline.short_name || discipline.name
      )}
    </span>
  );
}
