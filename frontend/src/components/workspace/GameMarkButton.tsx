"use client";

import { GameMark } from "@/components/workspace/GameMark";
import { cn } from "@/lib/utils";
import type { DisciplineDescriptor } from "@/types/discipline.types";

/**
 * A game's mark that narrows the scope to that game (spec §6.6-6.7). The game's name is the accessible name; the
 * click never reaches a clickable row or card around it.
 */
export function GameMarkButton({
  discipline,
  onSelect,
  size = 18,
  className
}: Readonly<{
  discipline: DisciplineDescriptor;
  onSelect: (code: string) => void;
  size?: number;
  className?: string;
}>) {
  return (
    <button
      type="button"
      aria-label={discipline.name}
      title={discipline.name}
      onClick={(event) => {
        event.stopPropagation();
        onSelect(discipline.code);
      }}
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-md outline-none transition-opacity hover:opacity-80 focus-visible:ring-2 focus-visible:ring-[color:var(--aqt-teal)]",
        className
      )}
    >
      <GameMark discipline={discipline} size={size} decorative />
    </button>
  );
}
