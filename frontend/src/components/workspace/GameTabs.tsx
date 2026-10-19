"use client";

import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { GameMark } from "@/components/workspace/GameMark";
import type { DisciplineDescriptor } from "@/types/discipline.types";

/**
 * Local game tabs (spec §4.3): a one-game page or block under "all games", over the enabled games.
 * Keyboard operable (Radix roving focus); the caller decides what a pick writes.
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
    <Tabs value={value} onValueChange={onSelect} className={className}>
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
