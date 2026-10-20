"use client";

import { GameMark } from "@/components/workspace/GameMark";
import { useGameDescriptors } from "@/hooks/useGameDescriptors";

/**
 * A game's icon by its slug (discipline code): non-interactive, with the game's name for assistive tech and on hover
 * (row marks, spec §6.1). Nothing for a slug the installed games do not know.
 */
export function GameIcon({ slug, size = 14 }: Readonly<{ slug: string; size?: number }>) {
  const game = useGameDescriptors().get(slug);
  if (!game) return null;
  return (
    <span title={game.name} className="inline-flex shrink-0 items-center">
      <GameMark discipline={game} size={size} decorative />
      <span className="sr-only">{game.name}</span>
    </span>
  );
}
