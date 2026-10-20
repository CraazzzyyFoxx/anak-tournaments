"use client";

import { GameMark } from "@/components/workspace/GameMark";
import { useGameDescriptors } from "@/hooks/useGameDescriptors";

/** A non-interactive game mark with the game's name for assistive tech and on hover (row marks, spec §6.1). */
export function GameMarkTag({ code, size = 14 }: Readonly<{ code: string; size?: number }>) {
  const game = useGameDescriptors().get(code);
  if (!game) return null;
  return (
    <span title={game.name} className="inline-flex shrink-0 items-center">
      <GameMark discipline={game} size={size} decorative />
      <span className="sr-only">{game.name}</span>
    </span>
  );
}
