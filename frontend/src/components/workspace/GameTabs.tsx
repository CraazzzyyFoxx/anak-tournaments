"use client";

import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { GameMark } from "@/components/workspace/GameMark";
import { cn } from "@/lib/utils";
import type { DisciplineDescriptor } from "@/types/discipline.types";

/**
 * Local game tabs (spec §4.3): a one-game page or block under "all games", over the enabled games.
 * Keyboard operable (Radix roving focus); arrows only move focus and Enter/Space picks (manual
 * activation), since a pick navigates. The caller decides what a pick writes.
 */
export function GameTabs({
  games,
  value,
  onSelect,
  label,
  className
}: Readonly<{
  games: DisciplineDescriptor[];
  value: string;
  onSelect: (code: string) => void;
  label: string;
  className?: string;
}>) {
  return (
    // `min-w-0`: in a flex row (`justify-end` page headers) the root would otherwise keep every tab's width and
    // spill past the viewport's left edge on a phone, instead of letting the list scroll.
    <Tabs value={value} onValueChange={onSelect} activationMode="manual" className={cn("min-w-0", className)}>
      <TabsList aria-label={label}>
        {games
          .filter((game) => game.enabled)
          .map((game) => (
            <TabsTrigger key={game.code} value={game.code}>
              <GameMark discipline={game} size={16} decorative />
              {game.name}
            </TabsTrigger>
          ))}
      </TabsList>
    </Tabs>
  );
}
